import { ALL_RULES } from "../rules/catalog";
import { CATALOG_CHECKED_AGAINST_ECFR_ISSUE, CATALOG_VERSION } from "../rules/catalog/util";
import { concernsExemption } from "../rules/content-review";
import type { RegulatoryRule, SourceCitation } from "../rules/types";
import { assertPlatformAdmin } from "../auth/rbac";
import { SCENARIOS, type Scenario } from "../workflows/scenarios";
import { scenarioHref } from "../workflows/slugs";
import { priorityOf } from "../workflows/priority";
import { compareSections, ecfrSectionUrl, parseCitation } from "./citations";
import type { SectionStatus } from "./ecfr";
import {
  OFFLINE_CODES,
  activityOf,
  changeFinding,
  changeRelevance,
  citationGroup,
  citedParts,
  citedSections,
  isOfficialUrl,
  latestReview,
  offlineFindings as offlineFindingsFor,
  openFindings,
  sectionsInGroup,
  type CoverageGroup,
  type DetectedChange,
  type Disposition,
  type Finding,
  type FindingReviews,
} from "./findings";

export { citedParts, DISPOSITION_LABEL, latestReview, openFindings } from "./findings";
export type { CoverageGroup, CoverageSection, DetectedChange, Disposition, Finding, FindingReview, FindingReviews, FindingSeverity } from "./findings";

/**
 * Regulatory Verification — resolving "pending review" steps.
 *
 * What this module can and cannot do:
 *   - It retrieves official text and runs deterministic citation checks. That is EVIDENCE.
 *     A successful retrieval never approves anything and never changes what customers see.
 *   - Only a platform administrator's explicit decision moves a step forward, and approval and
 *     publication are two separate deliberate actions.
 *   - Publication creates a new version of the step. Earlier versions, saved checklists (which
 *     keep their own snapshot) and the review history are never overwritten.
 *   - It is about the guidance. Whether a particular customer qualifies for anything is decided
 *     elsewhere, from their answers (see rules/content-review.ts).
 *
 * Framework-free: storage and source access are passed in, so the whole flow runs in tests.
 */

// ───────────────────────── Statuses and decisions ─────────────────────────

export const VERIFICATION_STATUSES = [
  "NOT_REVIEWED",
  "REVIEW_REQUIRED",
  "SOURCE_CHECKED",
  "CORRECTION_REQUESTED",
  "APPROVED_AWAITING_PUBLICATION",
  "REVIEWED_PUBLISHED",
  "REVERIFICATION_REQUIRED",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  NOT_REVIEWED: "Not yet reviewed",
  REVIEW_REQUIRED: "Review required",
  SOURCE_CHECKED: "Source checked, awaiting review",
  CORRECTION_REQUESTED: "Correction requested",
  APPROVED_AWAITING_PUBLICATION: "Approved — awaiting publication",
  REVIEWED_PUBLISHED: "Reviewed and published",
  REVERIFICATION_REQUIRED: "Reverification required",
};

export type Decision = "APPROVE" | "REQUEST_CORRECTION" | "INSUFFICIENT_EVIDENCE" | "REJECT";
export const DECISION_LABEL: Record<Decision, string> = {
  APPROVE: "Approve verified content",
  REQUEST_CORRECTION: "Request correction",
  INSUFFICIENT_EVIDENCE: "Mark insufficient evidence",
  REJECT: "Reject incorrect guidance",
};
/** Typed by the administrator to confirm; a click alone is not enough. */
export const APPROVE_CONFIRMATION = "APPROVE";
export const PUBLISH_CONFIRMATION = "PUBLISH";

export const REJECTED_NOTICE = "An administrator reviewed this step and found the guidance incorrect. A correction is being prepared. Do not rely on this step — confirm the requirement from the official text.";

// ───────────────────────── The claim and corrections ─────────────────────────

/** The wording and citations of a step — what a correction may replace. Decision logic is not included. */
export interface Wording {
  title: string;
  purpose: string;
  applicability: string;
  requiredAction: string[];
  documentation: string[];
  exceptions: string;
  verification: string;
  sources: SourceCitation[];
}

export function wordingOf(rule: RegulatoryRule): Wording {
  return {
    title: rule.title,
    purpose: rule.purpose,
    applicability: rule.applicability,
    requiredAction: [...rule.requiredAction],
    documentation: [...rule.documentation],
    exceptions: rule.exceptions,
    verification: rule.verification,
    sources: rule.sources.map((s) => ({ ...s })),
  };
}

export class VerificationError extends Error {
  constructor(message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
  }
}

/** A correction may change wording and citations only, and every citation must link to an official source. */
export function validateCorrection(w: Wording): Record<string, string> {
  const e: Record<string, string> = {};
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!text(w.title)) e.title = "A title is required.";
  if (!text(w.purpose)) e.purpose = "Required.";
  if (!text(w.applicability)) e.applicability = "Required.";
  if (!text(w.exceptions)) e.exceptions = "Required (use “None stated.” if there are none).";
  if (!text(w.verification)) e.verification = "Required.";
  if (!Array.isArray(w.requiredAction) || w.requiredAction.filter(text).length === 0) e.requiredAction = "At least one required action.";
  if (!Array.isArray(w.documentation) || w.documentation.filter(text).length === 0) e.documentation = "At least one documentation item.";
  if (!Array.isArray(w.sources) || w.sources.length === 0) e.sources = "At least one citation.";
  else
    for (const s of w.sources) {
      if (!text(s.citation)) e.sources = "Every citation needs its text.";
      else if (!isOfficialUrl(s.url)) e.sources = `“${s.citation}” must link to an official .gov source over https.`;
      else if (parseCitation(s)?.mismatch) e.sources = `“${s.citation}” names § ${parseCitation(s)!.mismatch} but links to § ${parseCitation(s)!.section}.`;
    }
  return e;
}

function cleanWording(w: Wording): Wording {
  const t = (s: string) => s.trim();
  return {
    title: t(w.title),
    purpose: t(w.purpose),
    applicability: t(w.applicability),
    requiredAction: w.requiredAction.map(t).filter(Boolean),
    documentation: w.documentation.map(t).filter(Boolean),
    exceptions: t(w.exceptions),
    verification: t(w.verification),
    sources: w.sources.map((s) => ({ citation: t(s.citation), url: t(s.url) })),
  };
}

// ───────────────────────── Deterministic findings ─────────────────────────

/** Offline findings for a step: its current wording and, when given, a proposed correction. See findings.ts. */
export function offlineFindings(rule: RegulatoryRule, catalog: RegulatoryRule[] = ALL_RULES, proposed: Wording | null = null, current: Wording = wordingOf(rule)): Finding[] {
  return offlineFindingsFor(rule, catalog, current, proposed);
}
// ───────────────────────── Queue priority ─────────────────────────

export type PriorityLevel = "HIGHEST" | "HIGH" | "NORMAL" | "LOW";
export interface QueuePriority {
  level: PriorityLevel;
  score: number;
  reasons: string[];
}

const EMERGENCY_WORKFLOWS = ["DOT_ACCIDENT_RESPONSE", "ROADSIDE_INSPECTION", "VEHICLE_MAINTENANCE"];

export function isSafetySensitive(rule: RegulatoryRule): boolean {
  return rule.blocksSafetySensitive || !!rule.prohibits || priorityOf({ ruleId: rule.id, rule, classification: "LEGALLY_REQUIRED", dueAt: null }).tier === 1;
}
export function isEmergencyRelevant(rule: RegulatoryRule): boolean {
  return rule.workflows.some((w) => EMERGENCY_WORKFLOWS.includes(w));
}

/** Orders the queue. It says what to look at first — nothing about whether a step is correct. */
export function queuePriority(rule: RegulatoryRule, findings: Finding[]): QueuePriority {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(why);
  };
  const tier = priorityOf({ ruleId: rule.id, rule, classification: "LEGALLY_REQUIRED", dueAt: null }).tier;
  const parts = citedParts(rule.sources);
  if (tier === 1) add(100, "Immediate safety requirement");
  if (rule.blocksSafetySensitive || rule.prohibits) add(80, "Operational or out-of-service restriction");
  if (concernsExemption(rule)) add(50, "Exemption claim");
  if (parts.includes("383")) add(50, "CDL eligibility and licensing");
  if (parts.includes("382") || parts.includes("40") || rule.recordCategory === "DRUG_ALCOHOL_PROGRAM") add(50, "Drug and alcohol testing");
  if (parts.includes("391") || rule.recordCategory === "DRIVER_QUALIFICATION_FILE") add(40, "Driver qualification");
  if (tier === 3) add(30, "Time-sensitive regulatory deadline");
  if (findings.some((f) => f.severity !== "INFO")) add(40, "Possible citation problem");
  return { level: score >= 80 ? "HIGHEST" : score >= 40 ? "HIGH" : score > 0 ? "NORMAL" : "LOW", score, reasons };
}

// ───────────────────────── Stored state ─────────────────────────

export interface SectionEvidence {
  section: string;
  /** Which citation(s) led to this section, and whether it came from the current step or the proposed correction. */
  citedBy: string[];
  origin: "CURRENT" | "PROPOSED" | "BOTH";
  /** Cited individually (true) or reached only through a range or subpart citation (false). */
  direct: boolean;
  /** ACTIVE, RESERVED or REMOVED per the eCFR; null when the section was not found or not checked. */
  activity: "ACTIVE" | "RESERVED" | "REMOVED" | null;
  officialUrl: string;
  retrievedFrom: string | null;
  retrievedAt: string;
  exists: boolean;
  removed: boolean;
  reserved: boolean;
  heading: string | null;
  /** eCFR issue the text was read at — the current issue at retrieval time. */
  issueDate: string | null;
  /** Date of the latest amendment to this section in the eCFR history. */
  lastAmended: string | null;
  /** Beginning of the retrieved text. An excerpt for the reviewer, not the whole section. */
  excerpt: string | null;
  textLength: number;
  textHash: string | null;
  error?: string;
}

export interface SourceCheck {
  checkedAt: string;
  checkedBy: string;
  /** RETRIEVED: every checkable section came back. Anything else leaves the step pending. */
  outcome: "RETRIEVED" | "PARTIAL" | "FAILED" | "NOTHING_TO_RETRIEVE";
  issueDate: string | null;
  sections: SectionEvidence[];
  findings: Finding[];
  /** Each range, subpart or part citation broken into its individual sections. */
  coverage: CoverageGroup[];
  /** Active sections cited individually that are not yet on the monitoring watch list for this step. */
  unmonitored: string[];
  relatedChanges: Array<Omit<DetectedChange, "detectedAt"> & { detectedAt: string; relevance: { level: string; why: string; sections: string[] } }>;
  requests: number;
}

export interface VerificationState {
  ruleId: string;
  status: VerificationStatus;
  assigneeId: string | null;
  lastSourceCheckAt: Date | null;
  sourceCheck: SourceCheck | null;
  proposedCorrection: Wording | null;
  proposedBy: string | null;
  proposedAt: Date | null;
  approvedReviewId: string | null;
  publishedVersion: number | null;
  publishedAt: Date | null;
  reverifyChangeId: string | null;
  rejectedAt: Date | null;
  /** Administrator dispositions of findings, with history, keyed by finding key. */
  findingReviews: FindingReviews | null;
}

export interface ReviewRecord {
  id: string;
  ruleId: string;
  ruleVersion: number;
  reviewerId: string;
  reviewedAt: Date;
  /** APPROVED | CORRECTION_REQUESTED | INSUFFICIENT_EVIDENCE | REJECTED | PUBLISHED */
  outcome: string;
  note: string | null;
  sources: string[];
  claim: Wording | null;
  previousWording: Wording | null;
  updatedWording: Wording | null;
  evidence: SourceCheck | null;
  regulatoryVersion: string | null;
}

export interface CorrectionVersion {
  ruleId: string;
  version: number;
  snapshot: RegulatoryRule;
  publishedAt: Date;
  reviewId: string | null;
  publishedById: string | null;
}

export interface Actor {
  id: string;
  orgId: string;
  platformAdmin?: boolean;
  disabled?: boolean;
}

export interface VerificationStore {
  getState(ruleId: string): Promise<VerificationState | null>;
  listStates(): Promise<VerificationState[]>;
  saveState(ruleId: string, patch: Partial<Omit<VerificationState, "ruleId">>): Promise<VerificationState>;
  addReview(r: Omit<ReviewRecord, "id">): Promise<ReviewRecord>;
  getReview(id: string): Promise<ReviewRecord | null>;
  listReviews(ruleId: string): Promise<ReviewRecord[]>;
  listCorrectionVersions(ruleId?: string): Promise<CorrectionVersion[]>;
  /** Must fail if (ruleId, version) already exists — versions are never overwritten. */
  createCorrectionVersion(v: CorrectionVersion): Promise<void>;
  /** Detected regulatory changes touching these sections (exact) or parts (Federal Register matches stop at the part). */
  changesFor(sections: string[], parts: string[]): Promise<DetectedChange[]>;
  /** Sections Regulatory Intelligence watches for this step: its catalog citations plus coverage an administrator added. */
  monitoredSections(ruleId: string): Promise<string[]>;
  /** Add sections to the watch list for this step. Never removes or changes existing entries. */
  addMonitoredSections(ruleId: string, items: Array<{ section: string; citationText: string }>): Promise<void>;
  audit(actor: Actor, action: string, ruleId: string, meta: Record<string, unknown>): Promise<void>;
}

export interface SourceFetcher {
  latestIssueDate(): Promise<string>;
  partStatus(part: string): Promise<Map<string, SectionStatus>>;
  sectionText(issueDate: string, section: string): Promise<{ text: string; hash: string; url: string }>;
  requests(): number;
}

const blankState = (ruleId: string, status: VerificationStatus): VerificationState => ({
  ruleId, status, assigneeId: null, lastSourceCheckAt: null, sourceCheck: null, proposedCorrection: null, proposedBy: null, proposedAt: null,
  approvedReviewId: null, publishedVersion: null, publishedAt: null, reverifyChangeId: null, rejectedAt: null, findingReviews: null,
});

export function findRule(ruleId: string, catalog: RegulatoryRule[] = ALL_RULES): RegulatoryRule {
  const rule = catalog.find((r) => r.id === ruleId);
  if (!rule) throw new VerificationError("Unknown workflow step.");
  return rule;
}

/** Before any administrator has acted: high-priority or flagged steps need review; the rest are simply not yet reviewed. */
export function initialStatus(rule: RegulatoryRule, catalog: RegulatoryRule[] = ALL_RULES): VerificationStatus {
  const findings = offlineFindings(rule, catalog);
  return queuePriority(rule, findings).level === "HIGHEST" || findings.some((f) => f.severity !== "INFO") ? "REVIEW_REQUIRED" : "NOT_REVIEWED";
}

async function stateOf(store: VerificationStore, rule: RegulatoryRule, catalog: RegulatoryRule[]): Promise<VerificationState> {
  return (await store.getState(rule.id)) ?? blankState(rule.id, initialStatus(rule, catalog));
}

// ───────────────────────── The queue ─────────────────────────

export interface QueueItem {
  rule: RegulatoryRule;
  /** The version customers currently see (the catalog step, or a published correction). */
  live: RegulatoryRule;
  scenarios: Array<{ n: number; title: string; href: string }>;
  status: VerificationStatus;
  state: VerificationState;
  priority: QueuePriority;
  findings: Finding[];
  safetySensitive: boolean;
  emergencyRelevant: boolean;
  exemption: boolean;
  /** Last time official sources were retrieved for this step, else the date the catalog entry was last checked, else null. */
  lastChecked: string | null;
}

const liveScenarios = (rule: RegulatoryRule): QueueItem["scenarios"] =>
  SCENARIOS.filter((s: Scenario) => s.status === "LIVE" && !s.aliasOf && s.workflow && rule.workflows.includes(s.workflow)).map((s) => ({ n: s.n, title: s.title, href: scenarioHref(s) }));

const LEVELS: PriorityLevel[] = ["HIGHEST", "HIGH", "NORMAL", "LOW"];

/** Every step whose guidance is flagged in the catalog, plus any step an administrator has already acted on. */
export function buildQueue(states: VerificationState[], corrections: CorrectionVersion[], catalog: RegulatoryRule[] = ALL_RULES): QueueItem[] {
  const byRule = new Map(states.map((s) => [s.ruleId, s]));
  const overrides = publishedOverrides(catalog, corrections, states);
  return catalog
    .filter((r) => r.verificationStatus === "REQUIRES_VERIFICATION" || byRule.has(r.id))
    .map((rule) => {
      const state = byRule.get(rule.id) ?? blankState(rule.id, initialStatus(rule, catalog));
      const findings = currentFindings(rule, overrides[rule.id] ?? rule, state, catalog);
      // Findings an administrator has dealt with no longer raise the step's priority.
      const open = findings.filter((f) => !["RESOLVED", "NOT_APPLICABLE"].includes(latestReview(state.findingReviews, f.key)?.disposition ?? ""));
      return {
        rule,
        live: overrides[rule.id] ?? rule,
        scenarios: liveScenarios(rule),
        status: state.status,
        state,
        priority: queuePriority(rule, open),
        findings,
        safetySensitive: isSafetySensitive(rule),
        emergencyRelevant: isEmergencyRelevant(rule),
        exemption: concernsExemption(rule),
        lastChecked: state.lastSourceCheckAt?.toISOString().slice(0, 10) ?? rule.lastVerified,
      };
    })
    .sort((a, b) => LEVELS.indexOf(a.priority.level) - LEVELS.indexOf(b.priority.level) || b.priority.score - a.priority.score || a.rule.id.localeCompare(b.rule.id));
}

// ───────────────────────── Official source check ─────────────────────────

const EXCERPT_CHARS = 1500;
/** Upper bound on sections whose text is retrieved in one check. */
const MAX_SECTIONS = 40;
/** Upper bound on sections listed for a part-level citation. */
const MAX_LISTED = 150;

interface Target {
  section: string;
  citedBy: Set<string>;
  current: boolean;
  proposed: boolean;
  /** Cited individually. False when the section is reached only through a range or subpart citation. */
  direct: boolean;
}

const liveOnly = (findings: Finding[]) => findings.filter((f) => !OFFLINE_CODES.includes(f.code));

/** Every finding that currently stands for a step: offline checks recomputed now, plus what the last source check found. */
export function currentFindings(rule: RegulatoryRule, live: RegulatoryRule, state: VerificationState, catalog: RegulatoryRule[] = ALL_RULES): Finding[] {
  return [...offlineFindings(rule, catalog, state.proposedCorrection, wordingOf(live)), ...liveOnly(state.sourceCheck?.findings ?? [])];
}

/**
 * Retrieve the cited sections from the official eCFR and record what came back.
 *
 * A range or subpart citation is expanded into its individual sections using the eCFR's own
 * section list, each with its status (active, reserved, removed) and official link. A part-level
 * citation is listed but nothing in it is retrieved or assumed to apply.
 *
 * Administrator-only. Stores evidence and deterministic findings; it never approves, never edits
 * a step and never changes what customers see. If anything could not be retrieved the step stays
 * where it was.
 */
export async function runSourceCheck(store: VerificationStore, fetcher: SourceFetcher, actor: Actor, ruleId: string, opts: { now?: Date; catalog?: RegulatoryRule[] } = {}): Promise<SourceCheck> {
  assertPlatformAdmin(actor);
  const catalog = opts.catalog ?? ALL_RULES;
  const rule = findRule(ruleId, catalog);
  const now = opts.now ?? new Date();
  const state = await stateOf(store, rule, catalog);
  const live = await liveRule(store, rule, catalog);
  const current = wordingOf(live).sources;
  const proposed = state.proposedCorrection?.sources ?? [];
  const hasDraft = !!state.proposedCorrection;
  const findings: Finding[] = offlineFindings(rule, catalog, state.proposedCorrection, wordingOf(live));
  const sections: SectionEvidence[] = [];
  let issueDate: string | null = null;
  let failed = 0;

  const add = (f: Omit<Finding, "key"> & { key?: string }) => findings.push({ ...f, key: f.key ?? `${f.code}|${f.section ?? f.citation ?? f.changeId ?? ""}` });
  const scope = (t: Pick<Target, "current" | "proposed">): Finding["appliesTo"] => (t.current && t.proposed ? "BOTH" : t.proposed ? "PROPOSED" : "CURRENT");
  const link = (section: string) => ({ label: `49 CFR § ${section}`, url: ecfrSectionUrl(49, section) });

  const partList = citedParts([...current, ...proposed]);
  const parts = new Map<string, Map<string, SectionStatus>>();
  try {
    if (partList.length) issueDate = await fetcher.latestIssueDate();
    for (const part of partList) {
      try {
        parts.set(part, await fetcher.partStatus(part));
      } catch (e) {
        failed++;
        add({
          code: "RETRIEVAL_FAILED", severity: "PROBLEM", key: `RETRIEVAL_FAILED|part-${part}`, appliesTo: "BOTH", sources: [],
          message: `Part ${part}: the section list could not be retrieved (${e instanceof Error ? e.message : "error"}).`,
          explanation: "Sections in this part were not checked. Nothing can be concluded about them from this check.",
          nextAction: "Run the check again later. The step stays pending until every cited section has been retrieved.",
        });
      }
    }
  } catch (e) {
    failed++;
    add({
      code: "RETRIEVAL_FAILED", severity: "PROBLEM", key: "RETRIEVAL_FAILED|ecfr", appliesTo: "BOTH", sources: [],
      message: `The eCFR could not be reached (${e instanceof Error ? e.message : "error"}).`,
      explanation: "Nothing was checked. A failed check is never read as “no problem found”.",
      nextAction: "Run the check again later. The step stays pending.",
    });
  }

  // What to retrieve: sections cited individually, and every section a range or subpart citation names.
  const targets = new Map<string, Target>();
  const want = (section: string, citation: string, from: "current" | "proposed", direct: boolean) => {
    const t = targets.get(section) ?? { section, citedBy: new Set<string>(), current: false, proposed: false, direct: false };
    t.citedBy.add(citation);
    t[from] = true;
    t.direct = t.direct || direct;
    targets.set(section, t);
  };
  const monitored = new Set(await store.monitoredSections(ruleId));
  const coverage: CoverageGroup[] = [];
  for (const [from, list] of [["current", current], ["proposed", proposed]] as const) {
    for (const s of list) {
      const parsed = parseCitation(s);
      const group = citationGroup(s);
      if (parsed && !group) want(parsed.section, s.citation, from, true);
      if (!group) continue;
      const known = parts.get(group.part);
      const inGroup = known ? sectionsInGroup(group, known) : [];
      // The section the citation's own link opens is always checked, even if the part's list could not be read.
      if (parsed) want(parsed.section, s.citation, from, group.kind === "PART");
      if (group.kind !== "PART") for (const st of inGroup) want(st.section, s.citation, from, false);
      const existing = coverage.find((c) => c.citation === s.citation);
      if (existing) existing.origin = "BOTH";
      else
        coverage.push({
          ...group,
          origin: from === "current" ? "CURRENT" : "PROPOSED",
          sections: inGroup.slice(0, MAX_LISTED).map((st) => ({
            section: st.section, heading: st.heading, activity: activityOf(st), officialUrl: ecfrSectionUrl(49, st.section),
            linkedNow: citedSections(current).includes(st.section), inCorrection: citedSections(proposed).includes(st.section), monitored: monitored.has(st.section),
            suggested: group.kind !== "PART" && activityOf(st) === "ACTIVE",
          })),
        });
    }
  }

  const all = [...targets.values()].sort((a, b) => compareSections(a.section, b.section)).slice(0, MAX_SECTIONS);
  for (const t of all) {
    const { section } = t;
    const part = section.split(".")[0];
    const known = parts.get(part);
    const citedBy = [...t.citedBy];
    const base: SectionEvidence = {
      section, citedBy, origin: scope(t), direct: t.direct, activity: null,
      officialUrl: ecfrSectionUrl(49, section), retrievedFrom: null, retrievedAt: now.toISOString(), exists: false, removed: false, reserved: false,
      heading: null, issueDate, lastAmended: null, excerpt: null, textLength: 0, textHash: null,
    };
    if (!known || !issueDate) {
      sections.push({ ...base, error: "Not checked: the part's section list was not retrieved." });
      continue;
    }
    const st = known.get(section);
    if (!st) {
      add({
        code: "SECTION_MISSING", severity: "PROBLEM", section, citation: citedBy[0], appliesTo: scope(t), sources: [link(section)],
        message: `§ ${section} is not in the eCFR's list of sections for Part ${part}.`,
        explanation: "The section number may be mistyped, or the section may never have existed. Content citing it cannot be approved.",
        nextAction: "Find the section that was meant and correct the citation in a proposed correction.",
      });
      sections.push(base);
      continue;
    }
    const activity = activityOf(st);
    const ev: SectionEvidence = { ...base, exists: true, removed: st.removed, reserved: activity === "RESERVED", activity, heading: st.heading, lastAmended: st.latestAmendment };
    if (activity !== "ACTIVE") {
      const what = activity === "REMOVED" ? "has been removed from the CFR" : "is reserved — a placeholder with no requirement in it";
      add({
        code: activity === "REMOVED" ? "SECTION_REMOVED" : "SECTION_RESERVED", severity: t.direct ? "PROBLEM" : "INFO", section, citation: citedBy[0], appliesTo: scope(t), sources: [link(section)],
        message: `§ ${section} ${what}${activity === "REMOVED" ? ` (last entry ${st.latestAmendment})` : ""}.`,
        explanation: t.direct
          ? "It is cited individually, as if it stated a requirement. An inactive section imposes no obligation and must not be cited as one; content citing it cannot be approved."
          : `It falls inside “${citedBy[0]}” but states no requirement. It is listed so the range is not read as if every section in it were an obligation; it is not offered for monitoring.`,
        nextAction: t.direct ? "Remove or replace this citation in a proposed correction." : "No action needed beyond citing the active sections individually (“Draft citation repair” proposes that).",
      });
      sections.push(ev);
      continue;
    }
    try {
      const got = await fetcher.sectionText(issueDate, section);
      ev.retrievedFrom = got.url;
      ev.textLength = got.text.length;
      ev.textHash = got.hash;
      ev.excerpt = got.text.slice(0, EXCERPT_CHARS);
    } catch (e) {
      failed++;
      ev.error = e instanceof Error ? e.message : "Retrieval failed";
      add({
        code: "RETRIEVAL_FAILED", severity: "PROBLEM", section, citation: citedBy[0], appliesTo: scope(t), sources: [link(section)],
        message: `§ ${section}: the text could not be retrieved (${ev.error}).`,
        explanation: "The section exists but its text was not obtained, so there is no evidence for it from this check.",
        nextAction: "Run the check again. Content citing this section cannot be approved until it has been retrieved.",
      });
    }
    // The catalog was written against this eCFR issue; an amendment after it has not been read by anyone here.
    if (st.latestAmendment > CATALOG_CHECKED_AGAINST_ECFR_ISSUE)
      add({
        code: "AMENDED_SINCE_CHECKED", severity: "POSSIBLE", section, citation: citedBy[0], appliesTo: scope(t), sources: [link(section)],
        message: `§ ${section} was amended on ${st.latestAmendment}, after the eCFR issue this step was written against (${CATALOG_CHECKED_AGAINST_ECFR_ISSUE}).`,
        explanation: "The step may describe the earlier text. Whether the amendment changes anything the step says can only be decided by reading it.",
        nextAction: "Compare the step with the current text of the section. Correct the wording if needed; otherwise mark this finding resolved and say what you compared.",
      });
    sections.push(ev);
  }

  // Detected regulatory changes: matched by section first; a shared part number alone is only ever "possible".
  const active = all.filter((t) => sections.find((s) => s.section === t.section)?.activity === "ACTIVE").map((t) => t.section);
  const relevantSections = [...new Set([...active, ...monitored])];
  const changes = (await store.changesFor(relevantSections, partList)).filter((c) => !["DISMISSED", "REJECTED"].includes(c.status));
  for (const c of changes) findings.push(changeFinding(c, relevantSections, hasDraft ? "BOTH" : "CURRENT"));

  // Sections cited individually that Regulatory Intelligence is not yet watching for this step.
  const unmonitored = all.filter((t) => t.direct && active.includes(t.section) && !monitored.has(t.section)).map((t) => t.section);

  // "Settled" = the source answered about this section (its text, or that it is reserved, removed or absent).
  // A section we could not ask about carries an error and is never counted.
  const settled = sections.filter((s) => !s.error && (s.textHash || s.reserved || s.removed || !s.exists)).length;
  const outcome: SourceCheck["outcome"] = all.length === 0 ? (failed ? "FAILED" : "NOTHING_TO_RETRIEVE") : failed === 0 && settled === sections.length ? "RETRIEVED" : settled > 0 ? "PARTIAL" : "FAILED";
  const check: SourceCheck = {
    checkedAt: now.toISOString(), checkedBy: actor.id, outcome, issueDate, sections, findings, coverage, unmonitored,
    relatedChanges: changes.map((c) => ({ ...c, detectedAt: c.detectedAt.toISOString(), relevance: changeRelevance(c, relevantSections) })), requests: fetcher.requests(),
  };

  // Only a complete retrieval moves "not reviewed / review required" to "source checked". It is never an approval.
  const advance = outcome === "RETRIEVED" && (state.status === "NOT_REVIEWED" || state.status === "REVIEW_REQUIRED");
  await store.saveState(ruleId, { ...((await store.getState(ruleId)) ? {} : { status: state.status }), lastSourceCheckAt: now, sourceCheck: check, ...(advance ? { status: "SOURCE_CHECKED" as const } : {}) });
  await store.audit(actor, "verification.source_check", ruleId, { outcome, issueDate, sections: sections.map((s) => `${s.section}:${s.activity ?? "?"}`), findings: findings.map((f) => f.key), requests: check.requests });
  return check;
}

// ───────────────────────── Findings, coverage and citation repair ─────────────────────────

/**
 * Record an administrator's handling of one finding: resolved, not applicable (a reason is
 * required), or requiring further review. Appended to the finding's history and to the audit log;
 * earlier entries are kept. This is bookkeeping about a finding — it approves nothing.
 */
export async function reviewFinding(store: VerificationStore, actor: Actor, ruleId: string, key: string, disposition: Disposition, note: string, opts: { now?: Date; catalog?: RegulatoryRule[] } = {}): Promise<VerificationState> {
  assertPlatformAdmin(actor);
  const catalog = opts.catalog ?? ALL_RULES;
  const rule = findRule(ruleId, catalog);
  const state = await stateOf(store, rule, catalog);
  const finding = currentFindings(rule, await liveRule(store, rule, catalog), state, catalog).find((f) => f.key === key);
  if (!finding) throw new VerificationError("That finding no longer exists for this step. Reload the page.");
  const text = note?.trim() ?? "";
  if (disposition === "NOT_APPLICABLE" && text.length < 10) throw new VerificationError("Give the reason this finding does not apply.", { note: "A documented reason is required." });
  if (disposition === "RESOLVED" && text.length < 10) throw new VerificationError("Say how this finding was resolved.", { note: "Required — what was done or checked." });
  if (!["RESOLVED", "NOT_APPLICABLE", "NEEDS_REVIEW"].includes(disposition)) throw new VerificationError("Unknown disposition.");
  const reviews: FindingReviews = { ...(state.findingReviews ?? {}) };
  reviews[key] = [...(reviews[key] ?? []), { disposition, note: text, by: actor.id, at: (opts.now ?? new Date()).toISOString(), message: finding.message }];
  const next = await store.saveState(ruleId, { status: state.status, findingReviews: reviews });
  await store.audit(actor, "verification.finding_reviewed", ruleId, { key, code: finding.code, disposition, note: text, message: finding.message, previous: latestReview(state.findingReviews, key)?.disposition ?? null });
  return next;
}

/**
 * Put sections on the Regulatory Intelligence watch list for this step. Only sections the last
 * source check found ACTIVE in a citation of this step (or its proposed correction) are accepted —
 * reserved and removed sections, and sections the check never saw, are refused. Monitoring a
 * section changes nothing customers see.
 */
export async function monitorCoverage(store: VerificationStore, actor: Actor, ruleId: string, sections: string[], opts: { catalog?: RegulatoryRule[] } = {}): Promise<string[]> {
  assertPlatformAdmin(actor);
  const catalog = opts.catalog ?? ALL_RULES;
  const rule = findRule(ruleId, catalog);
  const state = await stateOf(store, rule, catalog);
  const check = state.sourceCheck;
  if (!check) throw new VerificationError("Run “Check Official Sources” first, so the sections and their status are known.");
  const eligible = new Map<string, string>();
  for (const g of check.coverage ?? []) for (const s of g.sections) if (s.activity === "ACTIVE") eligible.set(s.section, g.citation);
  for (const s of check.sections) if (s.activity === "ACTIVE") eligible.set(s.section, eligible.get(s.section) ?? s.citedBy[0]);
  const wanted = [...new Set(sections)];
  const refused = wanted.filter((s) => !eligible.has(s));
  if (refused.length) throw new VerificationError(`Not added: § ${refused.join(", § ")} ${refused.length === 1 ? "is" : "are"} not an active section found in this step's citations by the last source check.`);
  const already = new Set(await store.monitoredSections(ruleId));
  const fresh = wanted.filter((s) => !already.has(s));
  if (fresh.length) await store.addMonitoredSections(ruleId, fresh.map((section) => ({ section, citationText: `Coverage of “${eligible.get(section)}”` })));
  await store.saveState(ruleId, { status: state.status });
  await store.audit(actor, "verification.coverage_monitored", ruleId, { added: fresh, alreadyMonitored: wanted.filter((s) => already.has(s)) });
  return fresh;
}

/**
 * A citation-only repair, as a DRAFT: each range or subpart citation is replaced by its active
 * sections cited individually (reserved and removed ones are left out), and a link that opens a
 * different section from the one named is pointed at the named section when that section exists.
 * Wording is not touched. Returns null when there is nothing to repair. Nothing is approved or published.
 */
export function proposeCitationRepair(base: Wording, check: SourceCheck): { wording: Wording; changes: string[] } | null {
  const changes: string[] = [];
  const sources: SourceCitation[] = [];
  const push = (s: SourceCitation) => {
    if (!sources.some((x) => x.citation === s.citation)) sources.push(s);
  };
  for (const s of base.sources) {
    const group = (check.coverage ?? []).find((g) => g.citation === s.citation && g.kind !== "PART");
    const parsed = parseCitation(s);
    if (group && group.sections.length) {
      const active = group.sections.filter((x) => x.activity === "ACTIVE");
      const dropped = group.sections.filter((x) => x.activity !== "ACTIVE");
      for (const x of active) push({ citation: `49 CFR ${x.section}`, url: x.officialUrl });
      changes.push(`“${s.citation}” → ${active.length} individual section${active.length === 1 ? "" : "s"} (§ ${active.map((x) => x.section).join(", § ")})${dropped.length ? `; left out as inactive: § ${dropped.map((x) => `${x.section} (${x.activity.toLowerCase()})`).join(", § ")}` : ""}.`);
    } else if (parsed?.mismatch && check.sections.some((x) => x.section === parsed.mismatch && x.activity === "ACTIVE")) {
      push({ citation: s.citation, url: ecfrSectionUrl(49, parsed.mismatch) });
      changes.push(`Link for “${s.citation}” pointed at § ${parsed.mismatch} (it opened § ${parsed.section}).`);
    } else if (parsed?.mismatch) {
      push(s);
      changes.push(`“${s.citation}” names § ${parsed.mismatch} but links to § ${parsed.section}; § ${parsed.mismatch} was not found active by the source check, so the link was left for you to correct.`);
    } else push(s);
  }
  if (JSON.stringify(sources) === JSON.stringify(base.sources)) return null;
  return { wording: { ...base, sources }, changes };
}

/** Save the citation repair as the proposed correction (on top of an existing draft's wording, if there is one). */
export async function draftCitationRepair(store: VerificationStore, actor: Actor, ruleId: string, opts: { now?: Date; catalog?: RegulatoryRule[] } = {}): Promise<{ state: VerificationState; changes: string[] }> {
  assertPlatformAdmin(actor);
  const catalog = opts.catalog ?? ALL_RULES;
  const rule = findRule(ruleId, catalog);
  const state = await stateOf(store, rule, catalog);
  if (!state.sourceCheck) throw new VerificationError("Run “Check Official Sources” first — the repair uses the sections it found.");
  const base = state.proposedCorrection ?? wordingOf(await liveRule(store, rule, catalog));
  const repair = proposeCitationRepair(base, state.sourceCheck);
  if (!repair) throw new VerificationError("There is nothing to repair: no range or subpart citation and no link that opens the wrong section.");
  const errors = validateCorrection(repair.wording);
  if (Object.keys(errors).length) throw new VerificationError("The citations were expanded, but the rest of the step is not yet complete enough to save as a correction. Edit the proposed correction and save it.", errors);
  const next = await saveProposedCorrection(store, actor, ruleId, repair.wording, { now: opts.now, catalog, proposedBy: state.proposedCorrection ? state.proposedBy ?? actor.id : "citation-repair" });
  await store.audit(actor, "verification.citation_repair_drafted", ruleId, { changes: repair.changes });
  return { state: next, changes: repair.changes };
}

// ───────────────────────── Administrator actions ─────────────────────────

/** Save or replace the draft correction. Editing a draft that was already approved withdraws that approval. */
export async function saveProposedCorrection(store: VerificationStore, actor: Actor, ruleId: string, wording: Wording, opts: { now?: Date; catalog?: RegulatoryRule[]; proposedBy?: string } = {}): Promise<VerificationState> {
  assertPlatformAdmin(actor);
  const catalog = opts.catalog ?? ALL_RULES;
  const rule = findRule(ruleId, catalog);
  const errors = validateCorrection(wording);
  if (Object.keys(errors).length) throw new VerificationError("The proposed correction is incomplete.", errors);
  const state = await stateOf(store, rule, catalog);
  const withdrawn = state.status === "APPROVED_AWAITING_PUBLICATION";
  const next = await store.saveState(ruleId, {
    status: withdrawn ? (state.sourceCheck?.outcome === "RETRIEVED" ? "SOURCE_CHECKED" : "REVIEW_REQUIRED") : state.status,
    proposedCorrection: cleanWording(wording), proposedBy: opts.proposedBy ?? actor.id, proposedAt: opts.now ?? new Date(),
    ...(withdrawn ? { approvedReviewId: null } : {}),
  });
  await store.audit(actor, "verification.correction_saved", ruleId, { approvalWithdrawn: withdrawn, proposedBy: opts.proposedBy ?? actor.id });
  return next;
}

export async function assignReviewer(store: VerificationStore, actor: Actor, ruleId: string, assigneeId: string | null, opts: { catalog?: RegulatoryRule[] } = {}): Promise<VerificationState> {
  assertPlatformAdmin(actor);
  const rule = findRule(ruleId, opts.catalog ?? ALL_RULES);
  const state = await stateOf(store, rule, opts.catalog ?? ALL_RULES);
  const next = await store.saveState(ruleId, { status: state.status, assigneeId });
  await store.audit(actor, "verification.assigned", ruleId, { assigneeId });
  return next;
}

export interface DecisionInput {
  decision: Decision;
  note: string;
  /** Official links the reviewer relied on, in addition to those retrieved by the source check. */
  sources?: string[];
  /** Must equal APPROVE_CONFIRMATION for an approval. */
  confirmation?: string;
}

/**
 * Record an administrator's decision. Approval requires official evidence, a written reason and a
 * typed confirmation, and results in "approved — awaiting publication": nothing customers see changes.
 */
export async function recordDecision(store: VerificationStore, actor: Actor, ruleId: string, input: DecisionInput, opts: { now?: Date; catalog?: RegulatoryRule[] } = {}): Promise<{ state: VerificationState; review: ReviewRecord }> {
  assertPlatformAdmin(actor);
  const catalog = opts.catalog ?? ALL_RULES;
  const rule = findRule(ruleId, catalog);
  const now = opts.now ?? new Date();
  const note = input.note?.trim() ?? "";
  if (note.length < 10) throw new VerificationError("Write a reviewer note explaining the decision.", { note: "Required — at least a sentence." });
  const state = await stateOf(store, rule, catalog);
  if (state.status === "APPROVED_AWAITING_PUBLICATION" && input.decision === "APPROVE") throw new VerificationError("This content is already approved and awaiting publication.");

  const live = (await liveRule(store, rule, catalog));
  const check = state.sourceCheck;
  const extra = (input.sources ?? []).map((s) => s.trim()).filter(Boolean);
  const bad = extra.find((u) => !isOfficialUrl(u));
  if (bad) throw new VerificationError("Evidence links must be official .gov sources over https.", { sources: `Not an official source: ${bad}` });
  const retrieved = (check?.sections ?? []).filter((s) => s.textHash).map((s) => s.officialUrl);
  const sources = [...new Set([...retrieved, ...extra])];

  let status: VerificationStatus = state.status;
  let outcome: string;
  const patch: Partial<VerificationState> = {};
  const approved = state.proposedCorrection ?? wordingOf(live);

  if (input.decision === "APPROVE") {
    if (input.confirmation !== APPROVE_CONFIRMATION) throw new VerificationError(`Type ${APPROVE_CONFIRMATION} to confirm the approval.`, { confirmation: "Confirmation required." });
    const errors = validateCorrection(approved);
    if (Object.keys(errors).length) throw new VerificationError("The content to be approved is incomplete or cites a source that is not official. Prepare a correction first.", errors);
    // Every CFR section the approved wording cites individually must have been retrieved by a source check.
    const target = state.proposedCorrection ? "PROPOSED" : "CURRENT";
    const needed = citedSections(approved.sources);
    const have = new Set((check?.sections ?? []).filter((s) => s.textHash).map((s) => s.section));
    const inactive = (check?.sections ?? []).filter((s) => needed.includes(s.section) && s.direct && (s.activity === "RESERVED" || s.activity === "REMOVED" || !s.exists));
    if (inactive.length)
      throw new VerificationError(`The content cites § ${inactive.map((s) => `${s.section} (${s.exists ? s.activity!.toLowerCase() : "not found"})`).join(", § ")} as a requirement. A reserved, removed or missing section cannot be approved as an obligation — correct the citations first.`, { sources: "Inactive section cited." });
    const missing = needed.filter((s) => !have.has(s));
    if (missing.length) throw new VerificationError(`Run “Check Official Sources” first: § ${missing.join(", § ")} ${missing.length === 1 ? "has" : "have"} not been retrieved for this content.`, { sources: "Source check incomplete." });
    // A citation that still names a range, subpart or part has not been resolved into the sections relied on.
    const findings = currentFindings(rule, live, state, catalog);
    if (findings.some((f) => f.code === "RETRIEVAL_FAILED" && (f.appliesTo === "BOTH" || f.appliesTo === target)))
      throw new VerificationError("The last source check was incomplete for this content. Run it again before approving.");
    // Every finding about this content must have been dealt with — resolved, or not applicable with a recorded reason.
    const open = openFindings(findings, state.findingReviews, target);
    if (open.length)
      throw new VerificationError(`${open.length} finding${open.length === 1 ? "" : "s"} on this content ${open.length === 1 ? "is" : "are"} still open. Mark each one resolved or not applicable (with the reason) before approving: ${open.map((f) => f.message).join(" | ")}`, { findings: "Open findings." });
    if (sources.length === 0) throw new VerificationError("Record at least one official source you relied on.", { sources: "Required." });
    status = "APPROVED_AWAITING_PUBLICATION";
    outcome = "APPROVED";
  } else if (input.decision === "REQUEST_CORRECTION") {
    status = "CORRECTION_REQUESTED";
    outcome = "CORRECTION_REQUESTED";
    patch.approvedReviewId = null;
  } else if (input.decision === "INSUFFICIENT_EVIDENCE") {
    status = "REVIEW_REQUIRED";
    outcome = "INSUFFICIENT_EVIDENCE";
    patch.approvedReviewId = null;
  } else {
    status = "CORRECTION_REQUESTED";
    outcome = "REJECTED";
    patch.rejectedAt = now;
    patch.approvedReviewId = null;
  }

  const review = await store.addReview({
    ruleId, ruleVersion: live.version, reviewerId: actor.id, reviewedAt: now, outcome, note, sources,
    claim: wordingOf(live), previousWording: wordingOf(live), updatedWording: input.decision === "APPROVE" ? approved : state.proposedCorrection,
    evidence: check, regulatoryVersion: check?.issueDate ?? null,
  });
  const next = await store.saveState(ruleId, { ...patch, status, ...(input.decision === "APPROVE" ? { approvedReviewId: review.id } : {}) });
  await store.audit(actor, `verification.decision.${outcome.toLowerCase()}`, ruleId, { reviewId: review.id, ruleVersion: live.version, sources, regulatoryVersion: review.regulatoryVersion });
  return { state: next, review };
}

/** The version customers currently see: the catalog step, or the latest published correction if newer. */
async function liveRule(store: VerificationStore, rule: RegulatoryRule, catalog: RegulatoryRule[]): Promise<RegulatoryRule> {
  return publishedOverrides(catalog, await store.listCorrectionVersions(rule.id), [])[rule.id] ?? rule;
}

export interface PublicationPreview {
  ruleId: string;
  fromVersion: number;
  toVersion: number;
  original: Wording;
  replacement: Wording;
  review: ReviewRecord;
  changedFields: Array<keyof Wording>;
}

/** What "Publish Correction" would do — shown to the administrator before they confirm. Nothing is written. */
export async function previewPublication(store: VerificationStore, actor: Actor, ruleId: string, opts: { catalog?: RegulatoryRule[] } = {}): Promise<PublicationPreview> {
  assertPlatformAdmin(actor);
  const catalog = opts.catalog ?? ALL_RULES;
  const rule = findRule(ruleId, catalog);
  const state = await stateOf(store, rule, catalog);
  if (state.status !== "APPROVED_AWAITING_PUBLICATION" || !state.approvedReviewId) throw new VerificationError("Only approved content can be published. Approve it first.");
  const review = await store.getReview(state.approvedReviewId);
  if (!review || review.outcome !== "APPROVED" || !review.updatedWording) throw new VerificationError("The approval record for this content could not be found.");
  const live = await liveRule(store, rule, catalog);
  const original = wordingOf(live);
  const replacement = review.updatedWording;
  const changedFields = (Object.keys(original) as Array<keyof Wording>).filter((k) => JSON.stringify(original[k]) !== JSON.stringify(replacement[k]));
  return { ruleId, fromVersion: live.version, toVersion: live.version + 1, original, replacement, review, changedFields };
}

/**
 * Publish approved content as a new version of the step. A separate, deliberate administrator
 * action. The wording published is exactly what was approved (taken from the approval record, not
 * from any later draft). Earlier versions and saved checklists are untouched.
 */
export async function publishCorrection(store: VerificationStore, actor: Actor, ruleId: string, confirmation: string, opts: { now?: Date; catalog?: RegulatoryRule[] } = {}): Promise<{ state: VerificationState; published: RegulatoryRule }> {
  assertPlatformAdmin(actor);
  if (confirmation !== PUBLISH_CONFIRMATION) throw new VerificationError(`Type ${PUBLISH_CONFIRMATION} to confirm publication.`, { confirmation: "Confirmation required." });
  const catalog = opts.catalog ?? ALL_RULES;
  const now = opts.now ?? new Date();
  const preview = await previewPublication(store, actor, ruleId, { catalog });
  const rule = findRule(ruleId, catalog);
  const live = await liveRule(store, rule, catalog);
  const date = now.toISOString().slice(0, 10);
  const { verificationNote: _dropNote, reviewNotice: _dropNotice, ...base } = live;
  const published: RegulatoryRule = {
    ...base,
    ...preview.replacement,
    version: preview.toVersion,
    lastVerified: date,
    verificationStatus: "VERIFIED",
    humanReview: { reviewedAt: preview.review.reviewedAt.toISOString(), reviewId: preview.review.id },
    changeLog: [...live.changeLog, { version: preview.toVersion, date, note: `Reviewed by an administrator and published (review ${preview.review.id}).${preview.changedFields.length ? ` Changed: ${preview.changedFields.join(", ")}.` : " Wording unchanged."}` }],
  };
  await store.createCorrectionVersion({ ruleId, version: preview.toVersion, snapshot: published, publishedAt: now, reviewId: preview.review.id, publishedById: actor.id });
  const publication = await store.addReview({
    ruleId, ruleVersion: preview.toVersion, reviewerId: actor.id, reviewedAt: now, outcome: "PUBLISHED", note: `Published approval ${preview.review.id}.`, sources: preview.review.sources,
    claim: preview.replacement, previousWording: preview.original, updatedWording: preview.replacement, evidence: preview.review.evidence, regulatoryVersion: preview.review.regulatoryVersion,
  });
  const state = await store.saveState(ruleId, { status: "REVIEWED_PUBLISHED", publishedVersion: preview.toVersion, publishedAt: now, rejectedAt: null, reverifyChangeId: null, proposedCorrection: null, proposedBy: null, proposedAt: null });
  await store.audit(actor, "verification.published", ruleId, { fromVersion: preview.fromVersion, toVersion: preview.toVersion, approvalReviewId: preview.review.id, publicationReviewId: publication.id, changedFields: preview.changedFields, catalogVersion: CATALOG_VERSION });
  return { state, published };
}

// ───────────────────────── What customers are served ─────────────────────────

/**
 * Published corrections layered over the code catalog. A correction applies only while it is newer
 * than the catalog's own version of that step. Steps an administrator rejected (and has not yet
 * replaced) carry a notice. Nothing else from the verification workflow reaches customers.
 */
export function publishedOverrides(catalog: RegulatoryRule[], corrections: CorrectionVersion[], states: VerificationState[]): Record<string, RegulatoryRule> {
  const out: Record<string, RegulatoryRule> = {};
  const state = new Map(states.map((s) => [s.ruleId, s]));
  for (const rule of catalog) {
    const latest = corrections.filter((c) => c.ruleId === rule.id && c.version > rule.version).sort((a, b) => b.version - a.version)[0];
    const st = state.get(rule.id);
    if (latest) {
      const snap = latest.snapshot;
      out[rule.id] = st?.status === "REVERIFICATION_REQUIRED" && snap.humanReview ? { ...snap, humanReview: { ...snap.humanReview, reverificationRequired: true } } : snap;
    }
    if (st?.rejectedAt && st.status === "CORRECTION_REQUESTED") out[rule.id] = { ...(out[rule.id] ?? rule), reviewNotice: REJECTED_NOTICE };
  }
  return out;
}

export function applyOverrides(rules: RegulatoryRule[], overrides: Record<string, RegulatoryRule> | undefined): RegulatoryRule[] {
  if (!overrides) return rules;
  return rules.map((r) => {
    const o = overrides[r.id];
    return o && (o.version > r.version || (o.version === r.version && o.reviewNotice)) ? o : r;
  });
}

// ───────────────────────── Regulatory Intelligence link ─────────────────────────

/**
 * Reviewed-and-published steps whose cited sections have a regulatory change detected AFTER the
 * review are moved to "reverification required". The published content is not altered or withdrawn;
 * the earlier approval stays in the history. Returns the steps that were flagged.
 */
export async function flagReverification(store: VerificationStore, opts: { catalog?: RegulatoryRule[] } = {}): Promise<Array<{ ruleId: string; changeId: string }>> {
  const catalog = opts.catalog ?? ALL_RULES;
  const corrections = await store.listCorrectionVersions();
  const flagged: Array<{ ruleId: string; changeId: string }> = [];
  for (const state of await store.listStates()) {
    if (state.status !== "REVIEWED_PUBLISHED" || !state.publishedAt) continue;
    const rule = catalog.find((r) => r.id === state.ruleId);
    if (!rule) continue;
    const live = publishedOverrides(catalog, corrections, [])[rule.id] ?? rule;
    const sections = [...new Set([...citedSections(live.sources), ...(await store.monitoredSections(rule.id))])];
    if (!sections.length) continue;
    // Re-review needs section-level evidence: the cited section's text changed, or a rule that is final or in
    // effect names it. A proposal, or a document that merely shares the part number, does not trigger it —
    // those are shown on the review screen as "possible" for the administrator to judge.
    const hit = (await store.changesFor(sections, citedParts(live.sources)))
      .filter((c) => c.detectedAt > state.publishedAt! && !["DISMISSED", "REJECTED"].includes(c.status))
      .filter((c) => {
        const level = changeRelevance(c, sections).level;
        return level === "CONFIRMED" || (level === "LIKELY" && ["EFFECTIVE", "FINAL_NOT_YET_EFFECTIVE"].includes(c.legalStatus));
      })
      .sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime())[0];
    if (!hit) continue;
    await store.saveState(state.ruleId, { status: "REVERIFICATION_REQUIRED", reverifyChangeId: hit.id });
    flagged.push({ ruleId: state.ruleId, changeId: hit.id });
  }
  return flagged;
}

// ───────────────────────── In-memory store (tests, and a reference for the Prisma store) ─────────────────────────

export function createMemoryVerificationStore(changes: DetectedChange[] = [], catalog: RegulatoryRule[] = ALL_RULES) {
  const states = new Map<string, VerificationState>();
  /** Coverage sections added by an administrator, per step. */
  const watch = new Map<string, Array<{ section: string; citationText: string }>>();
  const reviews: ReviewRecord[] = [];
  const versions: CorrectionVersion[] = [];
  const audits: Array<{ actorId: string; action: string; ruleId: string; meta: Record<string, unknown> }> = [];
  let seq = 0;
  const store: VerificationStore = {
    async getState(ruleId) {
      return states.get(ruleId) ?? null;
    },
    async listStates() {
      return [...states.values()];
    },
    async saveState(ruleId, patch) {
      const next = { ...(states.get(ruleId) ?? blankState(ruleId, "NOT_REVIEWED")), ...patch, ruleId };
      states.set(ruleId, next);
      return next;
    },
    async addReview(r) {
      const row = structuredClone({ ...r, id: `review_${++seq}` });
      reviews.push(row);
      return row;
    },
    async getReview(id) {
      return reviews.find((r) => r.id === id) ?? null;
    },
    async listReviews(ruleId) {
      return reviews.filter((r) => r.ruleId === ruleId);
    },
    async listCorrectionVersions(ruleId) {
      return versions.filter((v) => !ruleId || v.ruleId === ruleId);
    },
    async createCorrectionVersion(v) {
      if (versions.some((x) => x.ruleId === v.ruleId && x.version === v.version)) throw new Error("That version already exists.");
      versions.push(structuredClone(v));
    },
    async changesFor(sections, parts) {
      return changes.filter((c) => (c.section ? sections.includes(c.section) : c.parts.some((p) => parts.includes(p))));
    },
    async monitoredSections(ruleId) {
      const own = catalog.find((r) => r.id === ruleId);
      return [...new Set([...(own ? citedSections(own.sources) : []), ...(watch.get(ruleId) ?? []).map((w) => w.section)])];
    },
    async addMonitoredSections(ruleId, items) {
      const have = watch.get(ruleId) ?? [];
      watch.set(ruleId, [...have, ...items.filter((i) => !have.some((h) => h.section === i.section))]);
    },
    async audit(actor, action, ruleId, meta) {
      audits.push({ actorId: actor.id, action, ruleId, meta: structuredClone(meta) });
    },
  };
  return { store, states, reviews, versions, audits, changes, watch };
}
