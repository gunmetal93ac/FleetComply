import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { ALL_RULES, CATALOG_VERSION } from "@/lib/rules/catalog";
import { buildDependencyMap, impactOfParts, impactOfProvision, monitoredScenarios } from "@/lib/regulatory/dependencies";
import { compareSections } from "@/lib/regulatory/citations";
import { isEmptyPlan, planSync, readExistingState } from "@/lib/regulatory/sync";
import { scenarioHref } from "@/lib/workflows/slugs";
import { RunCheckButton } from "@/components/admin/RunCheckButton";
import { VerificationQueue } from "@/components/admin/VerificationQueue";
import { Alert, Badge, Card, CardBody, CardHeader, CardTitle, PageHeader, cn, type Tone } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const PENDING = ["DETECTED", "ANALYZING", "AWAITING_REVIEW", "NEEDS_INVESTIGATION"];

const LEGAL: Record<string, { label: string; tone: Tone }> = {
  PROPOSED: { label: "Proposed — not binding", tone: "slate" },
  FINAL_NOT_YET_EFFECTIVE: { label: "Final — not yet effective", tone: "amber" },
  EFFECTIVE: { label: "In effect", tone: "red" },
  STAYED: { label: "Stayed", tone: "amber" },
  WITHDRAWN: { label: "Withdrawn", tone: "slate" },
  NOTICE: { label: "Notice — not a rule", tone: "slate" },
  UNKNOWN: { label: "Status unknown — read the source", tone: "amber" },
};
const ACTION: Record<string, string> = {
  FINAL_RULE: "Final rule",
  PROPOSED_RULE: "Proposed rule",
  INTERIM_FINAL_RULE: "Interim final rule",
  CORRECTION: "Correction",
  DELAY: "Delay",
  STAY: "Stay",
  WITHDRAWAL: "Withdrawal",
  EXEMPTION: "Exemption",
  NOTICE: "Notice",
  TEXT_CHANGE: "CFR text changed",
  REMOVED: "CFR section removed",
};
const PRIORITY_TONE: Record<string, Tone> = { URGENT: "red", HIGH: "amber", NORMAL: "blue", LOW: "slate" };
const PRIORITY_ORDER = ["URGENT", "HIGH", "NORMAL", "LOW"];

type Search = { part?: string; legal?: string; cp?: string; src?: string; vst?: string; vw?: string; vsafe?: string; vem?: string };

/**
 * Regulatory Intelligence — administrator dashboard.
 * Stage 2: manual monitoring of eCFR and the Federal Register. Read-only review: nothing here
 * can modify or publish a workflow (review actions arrive in Stage 4).
 */
export default async function RegulatoryIntelligencePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;

  const map = buildDependencyMap();
  const [existing, provisions, sources, lastSuccess, failedRuns, allChanges, recentRuns, reviewedRules] = await Promise.all([
    readExistingState(prisma),
    prisma.regulatoryProvision.findMany({ include: { _count: { select: { refs: true, versions: true } }, versions: { orderBy: { fetchedAt: "desc" }, take: 1, select: { versionRef: true } } } }),
    prisma.regulatorySource.findMany({ orderBy: { key: "asc" } }),
    prisma.monitorRun.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }),
    prisma.monitorRun.count({ where: { status: { in: ["FAILED", "PARTIAL"] } } }),
    prisma.regulatoryChange.findMany({ orderBy: [{ publicationDate: "desc" }, { detectedAt: "desc" }], include: { provision: { select: { section: true } } } }),
    prisma.monitorRun.findMany({ orderBy: { startedAt: "desc" }, take: 8, include: { source: { select: { name: true, key: true } } } }),
    prisma.ruleReview.findMany({ select: { ruleId: true }, distinct: ["ruleId"] }),
  ]);

  const plan = planSync(existing, undefined, map);
  const inSync = isEmptyPlan(plan) && plan.staleRefs.length === 0;
  const scenarios = monitoredScenarios(undefined, map);
  const parts = [...new Set(provisions.map((p) => p.part))].sort((a, b) => Number(a) - Number(b));
  const shownProvisions = provisions.filter((p) => !sp.part || p.part === sp.part).sort((a, b) => compareSections(a.section, b.section));
  const neverChecked = provisions.filter((p) => !p.lastCheckedAt).length;
  const verified = ALL_RULES.filter((r) => r.verificationStatus === "VERIFIED").length;

  const pending = allChanges.filter((c) => PENDING.includes(c.status));
  const approved = allChanges.filter((c) => c.status === "APPROVED" || c.status === "PUBLISHED").length;
  const now = Date.now();
  const upcoming = allChanges
    .filter((c) => c.legalStatus === "FINAL_NOT_YET_EFFECTIVE" && c.effectiveDate && c.effectiveDate.getTime() > now)
    .sort((a, b) => a.effectiveDate!.getTime() - b.effectiveDate!.getTime());
  const changeParts = [...new Set(allChanges.flatMap((c) => c.cfrParts))].sort((a, b) => Number(a) - Number(b));
  const shownChanges = allChanges
    .filter((c) => (!sp.legal || c.legalStatus === sp.legal) && (!sp.cp || c.cfrParts.includes(sp.cp)) && (!sp.src || c.source === sp.src))
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || (b.publicationDate?.getTime() ?? 0) - (a.publicationDate?.getTime() ?? 0));
  const qs = (patch: Partial<Search>) => {
    const next = { ...sp, ...patch };
    const s = Object.entries(next).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
    return `/admin/regulatory${s ? `?${s}` : ""}#changes`;
  };

  return (
    <>
      <PageHeader
        title="Regulatory Intelligence"
        subtitle={`Administrator area. Rule catalog ${CATALOG_VERSION} — ${ALL_RULES.length} workflow steps, ${map.refs.length} references to ${map.provisions.length} CFR sections.`}
        actions={<RunCheckButton />}
      />

      <div className="space-y-6">
        <Alert tone="amber" title="Monitoring runs only when someone triggers it">
          No schedule is configured: official sources are checked when an administrator presses “Run check now” or runs <code className="rounded bg-white/60 px-1">npm.cmd run reg:check</code>.
          {lastSuccess ? <> The last successful check finished {fmt(lastSuccess.finishedAt)}. Anything published since then has not been seen.</> : <> No check has succeeded yet.</>} Detected items are
          for review only — nothing on this page can modify or publish a workflow, and classification here is by fixed rules, not legal analysis.
        </Alert>

        {!inSync && (
          <Alert tone="red" title="Dependency tables are out of date">
            The rule catalog and the database disagree ({plan.createProvisions.length} provisions, {plan.createRefs.length} references and {plan.createRuleVersions.length} rule versions to add;{" "}
            {plan.updateRefs.length} references to refresh; {plan.staleRefs.length} stale). Run <code className="rounded bg-white/60 px-1">npm.cmd run reg:sync</code> after any catalog change.
          </Alert>
        )}

        {/* ── Monitoring overview ── */}
        <section aria-label="Monitoring overview" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Monitored provisions" value={provisions.filter((p) => p.monitored).length} note={neverChecked ? `${neverChecked} never checked` : "all checked at least once"} />
          <Tile label="Published scenarios covered" value={scenarios.length} note="depend on at least one provision" />
          <Tile label="Last successful run" value={fmt(lastSuccess?.finishedAt) ?? "Never"} note="Next scheduled check: none configured" small />
          <Tile label="Failed or partial checks" value={failedRuns} tone={failedRuns ? "red" : undefined} />
          <Tile label="Detected items" value={allChanges.length} />
          <Tile label="Pending review" value={pending.length} tone={pending.length ? "amber" : undefined} />
          <Tile label="Approved updates" value={approved} note="approval arrives in Stage 4" />
          <Tile label="Taking effect soon" value={upcoming.length} note="final rules not yet effective" tone={upcoming.length ? "amber" : undefined} />
        </section>

        {/* ── Upcoming effective dates ── */}
        {upcoming.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Final rules not yet in effect</CardTitle></CardHeader>
            <CardBody>
              <ul className="space-y-2 text-sm">
                {upcoming.map((c) => {
                  const days = Math.ceil((c.effectiveDate!.getTime() - now) / 86_400_000);
                  return (
                    <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                      <Badge tone={days <= 30 ? "red" : "amber"}>Effective {day(c.effectiveDate)} · in {days} day{days === 1 ? "" : "s"}</Badge>
                      <a href={`#change-${c.id}`} className="font-medium text-navy-800 hover:text-brand-700">{c.title}</a>
                      <span className="text-xs text-slate-500">{c.citation}</span>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        )}

        {/* ── Verification queue ── */}
        <VerificationQueue sp={sp} basePath="/admin/regulatory" />

        {/* ── Detected changes ── */}
        <Card id="changes" className="scroll-mt-24">
          <CardHeader className="space-y-3">
            <CardTitle>Detected regulatory items ({shownChanges.length}{shownChanges.length !== allChanges.length ? ` of ${allChanges.length}` : ""})</CardTitle>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <Filter label="Status">
                <Chip href={qs({ legal: undefined })} active={!sp.legal}>All</Chip>
                {Object.keys(LEGAL).filter((k) => allChanges.some((c) => c.legalStatus === k)).map((k) => <Chip key={k} href={qs({ legal: k })} active={sp.legal === k}>{LEGAL[k].label}</Chip>)}
              </Filter>
              <Filter label="CFR part">
                <Chip href={qs({ cp: undefined })} active={!sp.cp}>All</Chip>
                {changeParts.map((p) => <Chip key={p} href={qs({ cp: p })} active={sp.cp === p}>{p}</Chip>)}
              </Filter>
              <Filter label="Source">
                <Chip href={qs({ src: undefined })} active={!sp.src}>All</Chip>
                <Chip href={qs({ src: "FEDERAL_REGISTER" })} active={sp.src === "FEDERAL_REGISTER"}>Federal Register</Chip>
                <Chip href={qs({ src: "ECFR" })} active={sp.src === "ECFR"}>eCFR text</Chip>
              </Filter>
            </div>
          </CardHeader>
          <CardBody className="space-y-2">
            {allChanges.length === 0 && (
              <p className="text-sm text-slate-600">
                Nothing has been recorded{lastSuccess ? " by the checks run so far" : " because no check has run"}. This reflects only what has been checked — <strong>it is not evidence that no regulation has changed.</strong>
              </p>
            )}
            {shownChanges.map((c) => {
              const impact = c.provision ? impactOfProvision(c.provision.section, undefined, map) : c.cfrParts.length ? impactOfParts(c.cfrParts, undefined, map) : null;
              const details = (c.details ?? {}) as Record<string, any>;
              const legal = LEGAL[c.legalStatus] ?? LEGAL.UNKNOWN;
              const later: string[] = details.laterFinalRulesInSameDocket ?? [];
              return (
                <details key={c.id} id={`change-${c.id}`} className="group scroll-mt-24 rounded-lg border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-semibold text-navy-800">{c.title}</p>
                      <Badge tone={PRIORITY_TONE[c.priority] ?? "slate"}>{c.priority.toLowerCase()} priority</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge tone={legal.tone}>{legal.label}</Badge>
                      <Badge>{ACTION[c.actionType ?? ""] ?? c.actionType}</Badge>
                      <Badge>{c.citation}</Badge>
                      <span className="text-slate-500">published {day(c.publicationDate)} · effective {day(c.effectiveDate)}</span>
                      {impact && <span className="text-slate-500">· {impact.rules.length} step{impact.rules.length === 1 ? "" : "s"}, {impact.scenarios.length} scenario{impact.scenarios.length === 1 ? "" : "s"} to consider</span>}
                    </div>
                  </summary>
                  <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-sm">
                    <p className="text-slate-700">{c.summary}</p>
                    <dl className="grid gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
                      <div><dt className="inline font-medium text-slate-700">Agency: </dt><dd className="inline">{c.agency ?? "—"}</dd></div>
                      <div><dt className="inline font-medium text-slate-700">Source: </dt><dd className="inline"><a className="text-brand-700 underline" href={c.sourceUrl} target="_blank" rel="noreferrer noopener">{c.source === "ECFR" ? "eCFR" : `Federal Register ${c.externalId}`}</a></dd></div>
                      <div><dt className="inline font-medium text-slate-700">Action line (from the source): </dt><dd className="inline">{details.action ?? "—"}</dd></div>
                      <div><dt className="inline font-medium text-slate-700">Review status: </dt><dd className="inline">{c.status.toLowerCase().replace("_", " ")} · detected {fmt(c.detectedAt)}</dd></div>
                    </dl>
                    {details.datesText && <p className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600"><span className="font-medium text-slate-700">Dates (from the source): </span>{String(details.datesText).slice(0, 700)}</p>}
                    {later.length > 0 && <p className="text-xs text-slate-600">A later final rule in the same docket exists ({later.join(", ")}), so this proposal has probably been acted on.</p>}
                    {c.legalStatus === "PROPOSED" && <p className="text-xs font-medium text-slate-700">This is a proposal. It imposes no requirement and no workflow should be changed on the strength of it.</p>}
                    {impact ? (
                      <div>
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Steps and scenarios to consider</h3>
                        <p className="mb-1.5 text-xs text-slate-500">
                          {c.provision
                            ? `Matched on the section (§ ${c.provision.section}).`
                            : `Matched on the CFR part only${details.partsBasis === "title" ? ", and the part was inferred from the notice’s title" : ""} — the source does not say which sections are affected, so this list is deliberately broad.`}{" "}
                          A match is a prompt to review, not a finding that a step is wrong.
                        </p>
                        <ul className="mb-2 flex flex-wrap gap-1.5">
                          {impact.scenarios.slice(0, 14).map((s) => <li key={s.n}><Link href={scenarioHref(s)} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 hover:bg-brand-50 hover:text-brand-700">#{s.n} {s.title}</Link></li>)}
                          {impact.scenarios.length > 14 && <li className="text-xs text-slate-500">+{impact.scenarios.length - 14} more</li>}
                        </ul>
                        <details>
                          <summary className="cursor-pointer text-xs text-brand-700">{impact.rules.length} workflow step{impact.rules.length === 1 ? "" : "s"}</summary>
                          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                            {impact.rules.map((r) => <li key={r.id}>{r.title} <span className="text-slate-400">· {r.id} · {r.paragraphs.join(", ") || "whole section"}</span></li>)}
                          </ul>
                        </details>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No current workflow step cites the CFR part(s) this publication concerns ({(details.allTitle49Parts ?? []).join(", ") || "none stated"}).</p>
                    )}
                  </div>
                </details>
              );
            })}
            {allChanges.length > 0 && shownChanges.length === 0 && <p className="text-sm text-slate-500">No items match these filters.</p>}
          </CardBody>
        </Card>

        {/* ── Sources ── */}
        <Card>
          <CardHeader><CardTitle>Official sources</CardTitle></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr><th className="px-5 py-2">Source</th><th className="px-5 py-2">Access</th><th className="px-5 py-2">Status</th><th className="px-5 py-2">Last successful check</th></tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100">
                    <td className="px-5 py-2"><span className="font-medium text-navy-800">{s.name}</span></td>
                    <td className="px-5 py-2 text-slate-600">{s.kind === "API" ? "Official API" : "Website — no structured feed selected"}</td>
                    <td className="px-5 py-2">
                      {s.enabled ? <Badge tone="blue">Checked on demand</Badge> : <Badge>Not monitored</Badge>}
                      {s.lockedUntil && s.lockedUntil.getTime() > now && <Badge tone="amber" className="ml-1">Check running</Badge>}
                    </td>
                    <td className="px-5 py-2 text-slate-600">{fmt(s.lastSuccessAt) ?? "Never"}</td>
                  </tr>
                ))}
                {sources.length === 0 && <tr><td colSpan={4} className="px-5 py-4 text-slate-500">No sources yet — run the sync.</td></tr>}
              </tbody>
            </table>
          </div>
          <CardBody className="text-xs text-slate-500">
            FMCSA and DOT websites are not monitored directly. Their rules, proposals and exemption notices reach this system through the Federal Register — but guidance, interpretations and
            other material published only on agency websites are <strong>not</strong> covered.
          </CardBody>
        </Card>

        {/* ── Run log ── */}
        <Card>
          <CardHeader><CardTitle>Monitoring run log</CardTitle></CardHeader>
          <CardBody className="space-y-2">
            {recentRuns.length === 0 && <p className="text-sm text-slate-600">No monitoring run has been executed.</p>}
            {recentRuns.map((r) => {
              const d = (r.details ?? {}) as Record<string, any>;
              const skipped: any[] = d.skipped ?? [];
              const failures: any[] = d.failures ?? [];
              return (
                <details key={r.id} className="rounded-lg border border-slate-200 bg-white">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                    <Badge tone={r.status === "SUCCEEDED" ? "green" : r.status === "RUNNING" ? "blue" : "red"}>{r.status.toLowerCase()}</Badge>
                    <span className="font-medium text-navy-800">{r.source?.name ?? "—"}</span>
                    <span className="text-xs text-slate-500">
                      {fmt(r.startedAt)} · {r.trigger.toLowerCase()} · attempt {r.attempt}
                      {r.source?.key === "ECFR" ? ` · ${r.provisionsChecked} sections checked` : ""} · {r.changesDetected} new · {d.http?.requests ?? 0} requests, {d.http?.retries ?? 0} retries
                      {skipped.length ? ` · ${skipped.length} skipped` : ""}
                    </span>
                  </summary>
                  <div className="space-y-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
                    {r.error && <p className="font-medium text-red-700">{r.error}</p>}
                    {d.note && <p className="font-medium text-red-700">{d.note}</p>}
                    {r.source?.key === "ECFR" && (
                      <p>eCFR issue {d.ecfrIssueDate ?? "—"} · baseline stored {d.baselineEstablished ?? 0} · unchanged {d.unchanged ?? 0} · text changed {(d.textChanged ?? []).length} · amended with identical text {(d.amendedButSameText ?? []).length} · removed {(d.removed ?? []).length}</p>
                    )}
                    {failures.length > 0 && <ul className="list-disc pl-4">{failures.map((f) => <li key={f.section}>§ {f.section} NOT checked — {f.error}</li>)}</ul>}
                    {(d.queries ?? []).map((q: any) => <p key={q.label}>Query: {q.label} — read {q.read} of {q.total}</p>)}
                    {d.skippedCounts && Object.keys(d.skippedCounts).length > 0 && (
                      <div>
                        <p className="font-medium text-slate-700">Skipped publications, by reason</p>
                        <ul className="list-disc pl-4">{Object.entries(d.skippedCounts as Record<string, number>).map(([reason, n]) => <li key={reason}>{n} × {reason}</li>)}</ul>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-brand-700">Show all {skipped.length} skipped identifiers</summary>
                          <ul className="mt-1 max-h-72 space-y-0.5 overflow-y-auto">
                            {skipped.map((s) => <li key={s.id}><span className="font-mono">{s.id}</span> · {s.published} · {s.type} · {s.reason} · <span className="text-slate-500">{s.title}</span></li>)}
                          </ul>
                        </details>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </CardBody>
        </Card>

        {/* ── Dependency map ── */}
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Regulatory dependency map</CardTitle>
            <nav className="flex flex-wrap gap-1 text-xs" aria-label="Filter by CFR part">
              <Chip href="/admin/regulatory" active={!sp.part}>All ({provisions.length})</Chip>
              {parts.map((p) => <Chip key={p} href={`/admin/regulatory?part=${p}`} active={sp.part === p}>Part {p} ({provisions.filter((x) => x.part === p).length})</Chip>)}
            </nav>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-sm text-slate-600">
              Each row is a CFR section cited by at least one workflow step. Open a row to see the steps and published scenarios that would need review if the section changed.
            </p>
            {shownProvisions.map((p) => {
              const impact = impactOfProvision(p.section, undefined, map);
              return (
                <details key={p.id} className="group rounded-lg border border-slate-200 bg-white">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1"><span className="font-semibold text-navy-800">{p.title} CFR {p.section}</span>{p.heading && <span className="ml-2 text-xs text-slate-500">{p.heading.replace(/^§\s*[\d.]+[A-Z]?\s*/, "")}</span>}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="blue">{impact.rules.length} step{impact.rules.length === 1 ? "" : "s"}</Badge>
                      <Badge>{impact.scenarios.length} scenario{impact.scenarios.length === 1 ? "" : "s"}</Badge>
                      <Badge tone={p.lastCheckedAt ? "green" : "slate"}>{p.lastCheckedAt ? `Checked ${day(p.lastCheckedAt)}` : "Never checked"}</Badge>
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-sm">
                    <p>
                      <a className="text-brand-700 underline" href={p.sourceUrl} target="_blank" rel="noreferrer noopener">Official text on eCFR</a>
                      <span className="text-slate-500"> · stored text versions: {p._count.versions}{p.versions[0] ? ` · last amended ${p.versions[0].versionRef}` : ""}</span>
                    </p>
                    <div>
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow steps that cite it</h3>
                      <ul className="space-y-1">
                        {impact.rules.map((r) => <li key={r.id}><span className="text-slate-800">{r.title}</span> <span className="text-xs text-slate-500">{r.id} · {r.paragraphs.length ? r.paragraphs.join(", ") : "whole section"} · {r.workflows.join(", ")}</span></li>)}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Published scenarios that use those steps</h3>
                      {impact.scenarios.length ? (
                        <ul className="flex flex-wrap gap-1.5">
                          {impact.scenarios.map((s) => <li key={s.n}><Link href={scenarioHref(s)} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 hover:bg-brand-50 hover:text-brand-700">#{s.n} {s.title}</Link></li>)}
                        </ul>
                      ) : (
                        <p className="text-slate-500">None published.</p>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
            {shownProvisions.length === 0 && <p className="text-sm text-slate-500">No provisions in the database yet — run <code>npm.cmd run reg:sync</code>.</p>}
          </CardBody>
        </Card>

        {/* ── Citation audit ── */}
        <Card>
          <CardHeader><CardTitle>Citation audit</CardTitle></CardHeader>
          <CardBody className="space-y-4 text-sm">
            <div>
              <h3 className="font-medium text-navy-800">{map.rulesWithoutProvision.length} steps cannot be monitored by regulation text</h3>
              <p className="mt-0.5 text-slate-600">These cite State law, an agency web page or nothing in the eCFR, so a text change cannot be detected for them automatically.</p>
              <ul className="mt-2 columns-1 gap-6 text-xs text-slate-600 md:columns-2">
                {map.rulesWithoutProvision.map((id) => {
                  const r = ALL_RULES.find((x) => x.id === id)!;
                  return <li key={id} className="mb-1 break-inside-avoid">{r.title} <span className="text-slate-400">· {id} · {r.jurisdiction.toLowerCase()}</span></li>;
                })}
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-navy-800">{map.mismatches.length} citations whose text and link disagree</h3>
              {map.mismatches.length === 0 ? <p className="mt-0.5 text-slate-600">None found.</p> : (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">{map.mismatches.map((m) => <li key={`${m.ruleId}-${m.citation}`}>{m.ruleId}: “{m.citation}” links to § {m.linkSection} (text names § {m.textSection})</li>)}</ul>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {map.unmonitored.length} individual source links are outside the monitored set. {verified} of {ALL_RULES.length} steps are marked “verified” in the catalog. {reviewedRules.length} step
              {reviewedRules.length === 1 ? " has" : "s have"} a review recorded in this system (review records start with the approval workflow in Stage 4).
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Tile({ label, value, note, tone, small }: { label: string; value: string | number; note?: string; tone?: "red" | "amber"; small?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-white px-4 py-3 shadow-card", tone === "red" ? "border-red-200" : tone === "amber" ? "border-highlight-400/60" : "border-slate-200/80")}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-1 font-bold tabular-nums text-navy-800", small ? "text-lg" : "text-2xl", tone === "red" && "text-red-700")}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1"><span className="mr-1 font-medium text-slate-500">{label}</span>{children}</div>;
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} className={cn("rounded-full px-2.5 py-1 font-medium", active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>{children}</Link>;
}
