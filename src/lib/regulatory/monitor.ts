import { decideEcfr, fetchSectionText, latestIssueDate, partStatus, type SectionStatus } from "./ecfr";
import { classifyDocument, fetchFederalRegister, laterRulesInSameDocket, summarize, type FrDocument } from "./federal-register";
import { SourceHttpClient, SourceRequestError } from "./http";
import { compareSections, ecfrSectionUrl } from "./citations";

/**
 * Regulatory monitor — one run of the eCFR and/or Federal Register checks.
 *
 * What a run may do: read official sources, store section text versions, and add rows to the
 * detected-change queue. What it can never do: modify, approve or publish compliance content.
 * This module has no access to the rule catalog's write path, and none exists.
 *
 * Failure rule: a section or query that could not be fetched is recorded as a failure. It is
 * never counted as "checked" and never read as "no change".
 */

export type SourceKey = "ECFR" | "FEDERAL_REGISTER";
export type RunStatus = "SUCCEEDED" | "PARTIAL" | "FAILED" | "SKIPPED_LOCKED";

export interface StoredProvision {
  id: string;
  title: number;
  part: string;
  section: string;
  latest: { id: string; versionRef: string; contentHash: string } | null;
}

export interface NewChange {
  source: SourceKey;
  externalId: string;
  provisionId?: string;
  sourceUrl: string;
  title: string;
  summary: string;
  agency: string | null;
  citation: string;
  actionType: string;
  legalStatus: string;
  priority: string;
  publicationDate: Date | null;
  effectiveDate: Date | null;
  previousVersionId?: string;
  newVersionId?: string;
  cfrParts: string[];
  details: Record<string, unknown>;
}

/** Storage the monitor needs. Implemented over Prisma in prisma-store.ts and in memory in tests. */
export interface MonitorStore {
  /** Atomically take the run lock for a source. False if another run holds it. */
  acquireLock(source: SourceKey, ttlMs: number): Promise<boolean>;
  releaseLock(source: SourceKey): Promise<void>;
  startRun(source: SourceKey, trigger: string, triggeredById: string | null, attempt: number): Promise<string>;
  finishRun(runId: string, result: { status: RunStatus; provisionsChecked: number; changesDetected: number; error: string | null; details: Record<string, unknown> }): Promise<void>;
  markSource(source: SourceKey, ok: boolean, at: Date): Promise<void>;
  listProvisions(): Promise<StoredProvision[]>;
  /** Store a text version. Returns the existing row if this exact text is already stored. */
  saveVersion(provisionId: string, v: { versionRef: string; contentHash: string; text: string; sourceUrl: string }): Promise<{ id: string; created: boolean }>;
  markChecked(provisionId: string, at: Date, opts: { changed: boolean; heading: string | null }): Promise<void>;
  /** Insert a detected change unless one with the same source + externalId exists. Returns whether it was created. */
  addChange(change: NewChange): Promise<boolean>;
}

export interface RunOptions {
  trigger: "MANUAL" | "SCHEDULED";
  triggeredById?: string | null;
  attempt?: number;
  /** Today as YYYY-MM-DD (injected for tests). */
  today?: string;
  now?: () => Date;
  /** Federal Register: publications on or after this date are in scope. */
  since: string;
  /** Federal Register: how far back to look for rules not yet effective and open proposals. */
  lookbackSince: string;
  lockTtlMs?: number;
}

export interface RunReport {
  source: SourceKey;
  status: RunStatus;
  runId: string | null;
  provisionsChecked: number;
  changesDetected: number;
  error: string | null;
  details: Record<string, unknown>;
}

const errText = (e: unknown) => (e instanceof SourceRequestError ? `${e.message} (${e.attempts} attempt${e.attempts === 1 ? "" : "s"})` : e instanceof Error ? e.message : String(e));
const asDate = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00.000Z`) : null);

// ───────────────────────── eCFR ─────────────────────────

export async function runEcfrCheck(store: MonitorStore, http: SourceHttpClient, opts: RunOptions): Promise<RunReport> {
  const now = opts.now ?? (() => new Date());
  if (!(await store.acquireLock("ECFR", opts.lockTtlMs ?? 20 * 60_000))) return { source: "ECFR", status: "SKIPPED_LOCKED", runId: null, provisionsChecked: 0, changesDetected: 0, error: "Another eCFR check is already running", details: {} };

  const runId = await store.startRun("ECFR", opts.trigger, opts.triggeredById ?? null, opts.attempt ?? 1);
  const failures: Array<{ section: string; error: string }> = [];
  const baselined: string[] = [];
  const unchanged: string[] = [];
  const changed: Array<{ section: string; from: string; to: string }> = [];
  const sameText: Array<{ section: string; amendment: string }> = [];
  const removed: string[] = [];
  let checked = 0;
  let created = 0;
  let fatal: string | null = null;
  let issueDate: string | null = null;

  try {
    const provisions = (await store.listProvisions()).sort((a, b) => compareSections(a.section, b.section));
    issueDate = await latestIssueDate(http);

    // One request per part gives the amendment history of every section in it.
    const parts = [...new Set(provisions.map((p) => p.part))].sort((a, b) => Number(a) - Number(b));
    const status = new Map<string, Map<string, SectionStatus> | Error>();
    for (const part of parts) {
      try {
        status.set(part, await partStatus(http, part));
      } catch (e) {
        status.set(part, e instanceof Error ? e : new Error(String(e)));
      }
    }

    for (const p of provisions) {
      const partResult = status.get(p.part)!;
      if (partResult instanceof Error) {
        failures.push({ section: p.section, error: `Part ${p.part} history unavailable: ${errText(partResult)}` });
        continue;
      }
      const remote = partResult.get(p.section);
      const decision = decideEcfr(p.latest, remote);
      try {
        if (decision.kind === "MISSING") {
          failures.push({ section: p.section, error: "Section not found in the eCFR history for its part — check the citation" });
          continue;
        }
        if (decision.kind === "UNCHANGED") {
          await store.markChecked(p.id, now(), { changed: false, heading: remote!.heading });
          unchanged.push(p.section);
          checked++;
          continue;
        }
        if (decision.kind === "REMOVED") {
          const made = await store.addChange({
            source: "ECFR",
            externalId: `49:${p.section}@${remote!.latestAmendment}:removed`,
            provisionId: p.id,
            sourceUrl: ecfrSectionUrl(p.title, p.section),
            title: `§ ${p.section} removed from the CFR`,
            summary: `eCFR reports that 49 CFR ${p.section} was removed, amendment dated ${remote!.latestAmendment}.`,
            agency: null,
            citation: `49 CFR ${p.section}`,
            actionType: "REMOVED",
            legalStatus: "EFFECTIVE",
            priority: "URGENT",
            publicationDate: null,
            effectiveDate: asDate(remote!.latestAmendment),
            previousVersionId: p.latest!.id,
            cfrParts: [p.part],
            details: { ecfrIssueDate: issueDate, amendmentDate: remote!.latestAmendment, previousVersionRef: p.latest!.versionRef },
          });
          if (made) created++;
          await store.markChecked(p.id, now(), { changed: true, heading: remote!.heading });
          removed.push(p.section);
          checked++;
          continue;
        }

        // BASELINE or FETCH_AND_COMPARE: read the current text.
        const fetched = await fetchSectionText(http, issueDate, p.section);
        const saved = await store.saveVersion(p.id, { versionRef: remote!.latestAmendment, contentHash: fetched.hash, text: fetched.text, sourceUrl: fetched.url });

        if (decision.kind === "BASELINE") {
          await store.markChecked(p.id, now(), { changed: false, heading: remote!.heading });
          baselined.push(p.section);
        } else if (fetched.hash === p.latest!.contentHash) {
          // A newer amendment date but identical text (e.g. an editorial republication): no alert.
          await store.markChecked(p.id, now(), { changed: false, heading: remote!.heading });
          sameText.push({ section: p.section, amendment: remote!.latestAmendment });
        } else {
          const made = await store.addChange({
            source: "ECFR",
            externalId: `49:${p.section}@${remote!.latestAmendment}`,
            provisionId: p.id,
            sourceUrl: ecfrSectionUrl(p.title, p.section),
            title: remote!.heading ?? `§ ${p.section}`,
            summary: `The text of 49 CFR ${p.section} changed (eCFR amendment dated ${remote!.latestAmendment}; previously stored version dated ${p.latest!.versionRef}).`,
            agency: null,
            citation: `49 CFR ${p.section}`,
            actionType: "TEXT_CHANGE",
            legalStatus: "EFFECTIVE",
            priority: "HIGH",
            publicationDate: null,
            effectiveDate: asDate(remote!.latestAmendment),
            previousVersionId: p.latest!.id,
            newVersionId: saved.id,
            cfrParts: [p.part],
            details: { ecfrIssueDate: issueDate, amendmentDate: remote!.latestAmendment, previousVersionRef: p.latest!.versionRef, previousHash: p.latest!.contentHash, newHash: fetched.hash },
          });
          if (made) created++;
          await store.markChecked(p.id, now(), { changed: true, heading: remote!.heading });
          changed.push({ section: p.section, from: p.latest!.versionRef, to: remote!.latestAmendment });
        }
        checked++;
      } catch (e) {
        // This section stays "not checked"; its lastCheckedAt is left untouched.
        failures.push({ section: p.section, error: errText(e) });
      }
    }
  } catch (e) {
    fatal = errText(e);
  }

  const total = checked + failures.length;
  const status: RunStatus = fatal ? "FAILED" : failures.length === 0 ? "SUCCEEDED" : checked === 0 ? "FAILED" : "PARTIAL";
  const details = {
    ecfrIssueDate: issueDate,
    monitored: total,
    baselineEstablished: baselined.length,
    unchanged: unchanged.length,
    textChanged: changed,
    amendedButSameText: sameText,
    removed,
    failures,
    http: { ...http.stats },
    note: failures.length ? "Sections listed under failures were NOT checked in this run. Their status is unknown, not unchanged." : undefined,
  };
  const error = fatal ?? (failures.length ? `${failures.length} of ${total} sections could not be checked` : null);
  try {
    await store.finishRun(runId, { status, provisionsChecked: checked, changesDetected: created, error, details });
    await store.markSource("ECFR", status === "SUCCEEDED", now());
  } finally {
    await store.releaseLock("ECFR");
  }
  return { source: "ECFR", status, runId, provisionsChecked: checked, changesDetected: created, error, details };
}

// ───────────────────────── Federal Register ─────────────────────────

export async function runFederalRegisterCheck(store: MonitorStore, http: SourceHttpClient, opts: RunOptions): Promise<RunReport> {
  const now = opts.now ?? (() => new Date());
  const today = opts.today ?? now().toISOString().slice(0, 10);
  if (!(await store.acquireLock("FEDERAL_REGISTER", opts.lockTtlMs ?? 20 * 60_000)))
    return { source: "FEDERAL_REGISTER", status: "SKIPPED_LOCKED", runId: null, provisionsChecked: 0, changesDetected: 0, error: "Another Federal Register check is already running", details: {} };

  const runId = await store.startRun("FEDERAL_REGISTER", opts.trigger, opts.triggeredById ?? null, opts.attempt ?? 1);
  let fatal: string | null = null;
  let created = 0;
  let truncated = false;
  const stored: Array<{ id: string; type: string; legalStatus: string; parts: string[]; new: boolean }> = [];
  const skipped: Array<{ id: string; type: string; published: string; reason: string; title: string }> = [];
  let queries: unknown[] = [];

  try {
    const monitoredParts = new Set((await store.listProvisions()).map((p) => p.part));
    const result = await fetchFederalRegister(http, { since: opts.since, lookbackSince: opts.lookbackSince });
    truncated = result.truncated;
    queries = result.queries;

    for (const doc of result.docs) {
      const c = classifyDocument(doc, { today, monitoredParts, since: opts.since });
      if (!c.store) {
        skipped.push({ id: doc.document_number, type: doc.type, published: doc.publication_date, reason: c.skipReason ?? "Not relevant", title: doc.title.slice(0, 140) });
        continue;
      }
      // A proposal with a later final rule in the same docket has probably been acted on: keep it, flag it, lower its priority.
      const later = laterRulesInSameDocket(doc, result.docs);
      const made = await store.addChange(toChange(doc, later.length ? { ...c, priority: "LOW" } : c, later));
      if (made) created++;
      stored.push({ id: doc.document_number, type: doc.type, legalStatus: c.legalStatus, parts: c.cfrParts, new: made });
    }
  } catch (e) {
    fatal = errText(e);
  }

  const skippedCounts: Record<string, number> = {};
  for (const s of skipped) skippedCounts[s.reason] = (skippedCounts[s.reason] ?? 0) + 1;
  const status: RunStatus = fatal ? "FAILED" : truncated ? "PARTIAL" : "SUCCEEDED";
  const details = {
    window: { since: opts.since, lookbackSince: opts.lookbackSince, today },
    queries,
    stored,
    alreadyRecorded: stored.filter((s) => !s.new).length,
    skippedCounts,
    skipped,
    http: { ...http.stats },
    note: truncated ? "A query returned more pages than were read. Some publications were NOT examined." : undefined,
  };
  const error = fatal ?? (truncated ? "Result set was larger than the page limit — not every publication was examined" : null);
  try {
    await store.finishRun(runId, { status, provisionsChecked: 0, changesDetected: created, error, details });
    await store.markSource("FEDERAL_REGISTER", status === "SUCCEEDED", now());
  } finally {
    await store.releaseLock("FEDERAL_REGISTER");
  }
  return { source: "FEDERAL_REGISTER", status, runId, provisionsChecked: 0, changesDetected: created, error, details };
}

function toChange(doc: FrDocument, c: ReturnType<typeof classifyDocument>, laterRules: string[] = []): NewChange {
  const agencies = (doc.agencies ?? []).map((a) => a.name ?? a.raw_name).filter(Boolean) as string[];
  const parts = c.cfrParts.length ? c.cfrParts : c.allParts;
  return {
    source: "FEDERAL_REGISTER",
    externalId: doc.document_number,
    sourceUrl: doc.html_url,
    title: doc.title.replace(/\s+/g, " ").trim().slice(0, 500),
    summary: summarize(doc, c) + (laterRules.length ? ` A later final rule in the same docket exists: ${laterRules.join(", ")}.` : ""),
    agency: agencies.join("; ") || null,
    citation: parts.length ? `49 CFR Part${parts.length > 1 ? "s" : ""} ${parts.join(", ")}` : "No CFR part stated",
    actionType: c.actionType,
    legalStatus: c.legalStatus,
    priority: c.priority,
    publicationDate: asDate(doc.publication_date),
    effectiveDate: asDate(doc.effective_on),
    cfrParts: c.cfrParts,
    details: {
      documentNumber: doc.document_number,
      documentType: doc.type,
      action: doc.action ?? null,
      datesText: doc.dates ?? null,
      abstract: doc.abstract ?? null,
      allTitle49Parts: c.allParts,
      partsBasis: c.partsBasis,
      correctionOf: doc.correction_of ?? null,
      docketIds: doc.docket_ids ?? [],
      laterFinalRulesInSameDocket: laterRules,
      classifiedBy: "deterministic rules (no AI)",
    },
  };
}

// ───────────────────────── Both sources ─────────────────────────

export async function runMonitor(store: MonitorStore, opts: RunOptions & { sources?: SourceKey[]; httpFactory?: () => SourceHttpClient }): Promise<RunReport[]> {
  const sources = opts.sources ?? ["ECFR", "FEDERAL_REGISTER"];
  const make = opts.httpFactory ?? (() => new SourceHttpClient());
  const reports: RunReport[] = [];
  if (sources.includes("ECFR")) reports.push(await runEcfrCheck(store, make(), opts));
  if (sources.includes("FEDERAL_REGISTER")) reports.push(await runFederalRegisterCheck(store, make(), opts));
  return reports;
}

/** Default Federal Register window: in scope from the eCFR issue date the catalog was checked against; look back 12 months for pending rules. */
export function defaultWindow(catalogCheckedAgainstIssue: string, today: string): { since: string; lookbackSince: string } {
  const back = new Date(`${today}T00:00:00Z`);
  back.setUTCFullYear(back.getUTCFullYear() - 1);
  return { since: catalogCheckedAgainstIssue, lookbackSince: back.toISOString().slice(0, 10) };
}
