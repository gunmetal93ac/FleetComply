import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { ALL_RULES } from "@/lib/rules/catalog";
import { prismaVerificationStore } from "@/lib/regulatory/verification-store";
import { buildQueue, previewPublication, STATUS_LABEL, wordingOf, type PublicationPreview, type Wording } from "@/lib/regulatory/verification";
import { WORKFLOWS } from "@/lib/workflows/definitions";
import { CheckSourcesButton, CorrectionEditor, DecisionPanel, PublishPanel } from "@/components/admin/VerificationReviewPanel";
import { CoveragePanel, FindingsPanel, type FindingView } from "@/components/admin/FindingsPanel";
import { LEVEL_TONE, STATUS_TONE } from "@/components/admin/VerificationQueue";
import { Alert, Badge, Card, CardBody, CardHeader, CardTitle, PageHeader, type Tone } from "@/components/ui";

export const dynamic = "force-dynamic";

const when = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const RELEVANCE: Record<string, { tone: Tone; label: string }> = {
  CONFIRMED: { tone: "red", label: "Confirmed — a cited section changed" },
  LIKELY: { tone: "amber", label: "Likely relevant — names a cited section" },
  POSSIBLE: { tone: "slate", label: "Possible — part-level match only" },
  UNLIKELY: { tone: "slate", label: "Probably not relevant" },
};const OUTCOME: Record<string, string> = {
  APPROVED: "Approved — awaiting publication",
  CORRECTION_REQUESTED: "Correction requested",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  REJECTED: "Rejected as incorrect",
  PUBLISHED: "Published",
};

/** Administrator-only review screen for one step's regulatory content. */
export default async function VerificationReviewPage({ params }: { params: Promise<{ ruleId: string }> }) {
  const admin = await requirePlatformAdmin();
  const ruleId = decodeURIComponent((await params).ruleId);
  if (!ALL_RULES.some((r) => r.id === ruleId)) notFound();

  const store = prismaVerificationStore(prisma);
  const [states, corrections, reviews] = await Promise.all([store.listStates(), store.listCorrectionVersions(), store.listReviews(ruleId)]);
  const item = buildQueue(states, corrections).find((i) => i.rule.id === ruleId);
  if (!item) notFound();
  const { rule, live, state } = item;
  const check = state.sourceCheck;
  const current = wordingOf(live);
  const draft = state.proposedCorrection;
  let preview: PublicationPreview | null = null;
  if (state.status === "APPROVED_AWAITING_PUBLICATION") preview = await previewPublication(store, { id: admin.id, orgId: admin.orgId, platformAdmin: true }, ruleId).catch(() => null);

  const findingReviewers = Object.values(state.findingReviews ?? {}).flatMap((h) => h.map((x) => x.by));
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set([...reviews.map((r) => r.reviewerId), ...findingReviewers, state.proposedBy ?? "", check?.checkedBy ?? ""].filter(Boolean))] } }, select: { id: true, name: true, email: true } });
  const who = (id: string | null | undefined) => (id ? people.find((p) => p.id === id)?.name ?? (id === "system-draft" ? "Prepared draft (not a reviewer)" : id === "citation-repair" ? "Automatic citation repair (not a reviewer)" : "Former user") : "—");
  const change = state.reverifyChangeId ? await prisma.regulatoryChange.findUnique({ where: { id: state.reverifyChangeId } }) : null;
  const versions = corrections.filter((c) => c.ruleId === ruleId).sort((a, b) => b.version - a.version);
  const findingViews: FindingView[] = item.findings.map((f) => ({
    finding: f,
    history: (state.findingReviews?.[f.key] ?? []).map((h) => ({ ...h, byName: who(h.by) })),
    addressedByDraft: !!draft && f.appliesTo === "CURRENT",
  }));

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/regulatory#verification" className="text-brand-700">← Regulatory Verification Queue</Link></p>
      <PageHeader
        title={live.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            <Badge tone={LEVEL_TONE[item.priority.level]}>{item.priority.level.toLowerCase()} priority</Badge>
            {item.safetySensitive && <Badge tone="red">Safety-sensitive</Badge>}
            <span>Step {rule.id} · version {live.version} · {rule.workflows.map((w) => WORKFLOWS[w]?.title ?? w).join(", ")}</span>
          </span>
        }
      />

      <div className="max-w-5xl space-y-6">
        <Alert tone="blue" title="What a review here does — and does not — establish">
          This screen is about the guidance: whether the wording and citations shown to users state the official text correctly. It never decides whether a particular customer or driver qualifies —
          that stays with their own facts and records. Retrieving a source is evidence, not approval. FleetComply is a reference tool, not a legal authority.
        </Alert>

        {state.status === "REVERIFICATION_REQUIRED" && (
          <Alert tone="red" title="A regulatory change was detected after this content was reviewed">
            Reviewed and published {when(state.publishedAt)}.{" "}
            {change ? <>Detected item: <a className="underline" href={change.sourceUrl} target="_blank" rel="noreferrer noopener">{change.title ?? change.summary}</a> ({when(change.detectedAt)}).</> : "The detected item is in the Regulatory Intelligence list."}{" "}
            The published content has not been changed. Check the sources again and record a new decision; the earlier approval stays in the history below.
          </Alert>
        )}
        {state.rejectedAt && state.status === "CORRECTION_REQUESTED" && (
          <Alert tone="red" title="This guidance was rejected as incorrect">Customers see a notice on this step telling them not to rely on it. It stays until a correction is approved and published.</Alert>
        )}

        {/* ── Regulatory claim ── */}
        <Card>
          <CardHeader><CardTitle>Regulatory Claim — what users currently see</CardTitle></CardHeader>
          <CardBody className="space-y-4 text-sm">
            <WordingView w={current} />
            <p className="text-xs text-slate-500">
              Why review is needed: {rule.verificationNote ?? "—"} · Shown in:{" "}
              {item.scenarios.length ? item.scenarios.map((s, k) => <span key={s.n}>{k > 0 && ", "}<Link className="text-brand-700 hover:underline" href={s.href}>{s.title}</Link></span>) : "no published scenario"}
            </p>
            {item.priority.reasons.length > 0 && <p className="text-xs text-slate-500">Queue priority: {item.priority.reasons.join(" · ")}. Priority orders the queue; it is not a finding.</p>}
          </CardBody>
        </Card>

        {/* ── Applicability ── */}
        <Card>
          <CardHeader><CardTitle>Applicability</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm text-slate-700">
            <p><span className="font-medium">Jurisdiction:</span> {rule.jurisdiction.toLowerCase()} · {rule.authority} · {rule.commerceScope === "INTERSTATE_ONLY" ? "interstate (intrastate per State adoption)" : rule.commerceScope === "ALL_COMMERCE" ? "interstate and intrastate" : "not commerce-based"}{rule.stateDependent ? ` · depends on State law (${rule.stateDependent.topic})` : ""}</p>
            <p><span className="font-medium">Shown to a user when:</span> <code className="rounded bg-slate-100 px-1 text-xs">{JSON.stringify(rule.appliesWhen)}</code></p>
            <p><span className="font-medium">Stated conditions:</span> {live.applicability}</p>
            <p><span className="font-medium">Exceptions:</span> {live.exceptions}</p>
            <p><span className="font-medium">Deadline:</span> {live.deadline.description}</p>
            <p><span className="font-medium">Dates:</span> catalog entry last checked {rule.lastVerified ?? "never"} · written against eCFR issue {check?.issueDate ? `(latest retrieved: ${check.issueDate})` : "2026-10-05"}</p>
            <p className="rounded-lg bg-highlight-50/70 px-3 py-2 ring-1 ring-inset ring-highlight-100">
              <span className="font-semibold">Customer eligibility is separate.</span> Approving this content does not establish that any customer meets these conditions.
              {item.exemption && " For an exemption, the step itself must list the eligibility conditions and the supporting documents the customer has to hold — check that the wording does."}
            </p>
          </CardBody>
        </Card>

        {/* ── Official sources ── */}
        <Card>
          <CardHeader className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Official Sources</CardTitle>
              <p className="mt-1 text-sm text-slate-600">{check ? `Last retrieved ${when(check.checkedAt)} by ${who(check.checkedBy)} · eCFR issue ${check.issueDate ?? "—"} · ${check.requests} request(s)` : "Not retrieved yet."}</p>
            </div>
            <CheckSourcesButton ruleId={ruleId} />
          </CardHeader>
          <CardBody className="space-y-4 text-sm">
            {check && check.outcome !== "RETRIEVED" && check.outcome !== "NOTHING_TO_RETRIEVE" && <Alert tone="red">The last check was incomplete ({check.outcome.toLowerCase()}). The step stays pending until every cited section is retrieved.</Alert>}
            {check?.sections.map((s) => (
              <details key={s.section} className="group rounded-lg border border-slate-200">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3">
                  <span className="font-semibold text-navy-800">49 CFR § {s.section}</span>
                  <span className="text-slate-600">{s.heading ?? ""}</span>
                  {!s.exists ? <Badge tone="red">Not found in the eCFR</Badge> : s.removed ? <Badge tone="red">Removed — not a requirement</Badge> : s.reserved ? <Badge tone="amber">Reserved — not a requirement</Badge> : s.textHash ? <Badge tone="green">Active · current text retrieved</Badge> : <Badge tone="red">Not retrieved</Badge>}
                  {s.direct === false && <Badge>Via a range or subpart citation</Badge>}
                  <Badge>{s.origin === "CURRENT" ? "Cited now" : s.origin === "PROPOSED" ? "In proposed correction" : "Cited now and in correction"}</Badge>
                </summary>
                <div className="space-y-2 border-t border-slate-100 px-4 py-3 text-slate-700">
                  <p>
                    <a className="font-medium text-brand-700 underline" href={s.officialUrl} target="_blank" rel="noreferrer noopener">Open the official section</a>
                    {" · "}retrieved {when(s.retrievedAt)} · eCFR issue {s.issueDate ?? "—"} (current at retrieval, not a historical version) · last amended {s.lastAmended ?? "—"}
                  </p>
                  <p className="text-xs text-slate-500">Cited as: {s.citedBy.join("; ")}</p>
                  {s.error && <p className="text-red-700">{s.error}</p>}
                  {s.excerpt && (
                    <>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Excerpt — first {s.excerpt.length.toLocaleString()} of {s.textLength.toLocaleString()} characters. Read the full section at the link before deciding.</p>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">{s.excerpt}{s.textLength > s.excerpt.length ? "\n…" : ""}</pre>
                    </>
                  )}
                </div>
              </details>
            ))}
            {check && check.relatedChanges.length > 0 && (
              <div>
                <p className="font-medium text-navy-800">Detected regulatory items and why each may or may not be relevant</p>
                <ul className="mt-2 space-y-2">
                  {check.relatedChanges.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start gap-2">
                      <Badge tone={RELEVANCE[c.relevance?.level ?? "POSSIBLE"].tone}>{RELEVANCE[c.relevance?.level ?? "POSSIBLE"].label}</Badge>
                      <span className="min-w-0 flex-1">
                        <a className="text-brand-700 underline" href={c.sourceUrl} target="_blank" rel="noreferrer noopener">{c.title}</a> — {c.legalStatus.toLowerCase().replaceAll("_", " ")}
                        <span className="block text-xs text-slate-600">{c.relevance?.why}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-slate-500">
              Only the eCFR is retrieved automatically. FMCSA guidance and State agency pages are not fetched: open them yourself and list the links you relied on with your decision. Summaries from other websites are not evidence.
            </p>
          </CardBody>
        </Card>

        {/* ── Citation coverage ── */}
        {check && ((check.coverage ?? []).length > 0 || (check.unmonitored ?? []).length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>Citation Coverage</CardTitle>
              <p className="mt-1 text-sm text-slate-600">Each range, subpart or part citation broken into its individual sections, from the eCFR's own list (issue {check.issueDate ?? "—"}).</p>
            </CardHeader>
            <CardBody><CoveragePanel ruleId={ruleId} groups={check.coverage ?? []} unmonitored={check.unmonitored ?? []} canRepair={(check.coverage ?? []).some((g) => g.kind !== "PART")} /></CardBody>
          </Card>
        )}

        {/* ── Deterministic findings ── */}
        <Card>
          <CardHeader><CardTitle>Deterministic Checks</CardTitle></CardHeader>
          <CardBody><FindingsPanel ruleId={ruleId} findings={findingViews} /></CardBody>
        </Card>

        {/* ── Proposed correction ── */}
        <Card>
          <CardHeader>
            <CardTitle>Proposed Correction</CardTitle>
            {draft && <p className="mt-1 text-sm text-slate-600">Draft saved {when(state.proposedAt)} — {who(state.proposedBy)}. Not visible to customers.</p>}
          </CardHeader>
          <CardBody>
            <CorrectionEditor
              key={`${state.proposedAt?.toISOString() ?? "none"}-${live.version}`}
              ruleId={ruleId}
              initial={draft ?? current}
              isDraft={!!draft}
            />
            {state.status === "APPROVED_AWAITING_PUBLICATION" && <p className="mt-3 text-sm text-highlight-700">Saving a change to this draft withdraws the approval — the edited wording would have to be approved again.</p>}
          </CardBody>
        </Card>

        {/* ── Decision ── */}
        <Card>
          <CardHeader><CardTitle>Reviewer Notes and Review Actions</CardTitle></CardHeader>
          <CardBody><DecisionPanel ruleId={ruleId} hasDraft={!!draft} alreadyApproved={state.status === "APPROVED_AWAITING_PUBLICATION"} /></CardBody>
        </Card>

        {/* ── Publication ── */}
        {preview && (
          <Card className="border-violet-200">
            <CardHeader>
              <CardTitle>Publish Correction</CardTitle>
              <p className="mt-1 text-sm text-slate-600">Approved {when(preview.review.reviewedAt)} by {who(preview.review.reviewerId)}. Nothing has changed for customers yet.</p>
            </CardHeader>
            <CardBody className="space-y-5 text-sm">
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 font-semibold text-slate-600">Original — version {preview.fromVersion}</p>
                  <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200"><WordingView w={preview.original} highlight={preview.changedFields} /></div>
                </div>
                <div>
                  <p className="mb-2 font-semibold text-accent-700">Replacement — version {preview.toVersion}</p>
                  <div className="rounded-lg bg-accent-50/50 p-3 ring-1 ring-inset ring-accent-100"><WordingView w={preview.replacement} highlight={preview.changedFields} /></div>
                </div>
              </div>
              <p><span className="font-medium">Changed:</span> {preview.changedFields.length ? preview.changedFields.join(", ") : "nothing — the current wording was approved as it stands; publishing records it as reviewed."}</p>
              <p><span className="font-medium">Reviewer notes:</span> {preview.review.note}</p>
              <p><span className="font-medium">Sources relied on:</span> {preview.review.sources.map((u, k) => <span key={u}>{k > 0 && ", "}<a className="text-brand-700 underline" href={u} target="_blank" rel="noreferrer noopener">{u.replace("https://www.ecfr.gov/current/title-49/section-", "§ ")}</a></span>)} · eCFR issue {preview.review.regulatoryVersion ?? "—"}</p>
              <PublishPanel ruleId={ruleId} toVersion={preview.toVersion} />
            </CardBody>
          </Card>
        )}

        {/* ── History ── */}
        <Card>
          <CardHeader><CardTitle>Review history</CardTitle></CardHeader>
          <CardBody className="space-y-4 text-sm">
            {reviews.length === 0 && <p className="text-slate-500">No administrator has recorded a decision on this step.</p>}
            {reviews.map((r) => (
              <details key={r.id} className="rounded-lg border border-slate-200">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3">
                  <Badge tone={r.outcome === "APPROVED" || r.outcome === "PUBLISHED" ? "green" : r.outcome === "REJECTED" ? "red" : "amber"}>{OUTCOME[r.outcome] ?? r.outcome}</Badge>
                  <span className="font-medium text-navy-800">{who(r.reviewerId)}</span>
                  <span className="text-slate-500">{when(r.reviewedAt)} · step version {r.ruleVersion} · eCFR issue {r.regulatoryVersion ?? "—"}</span>
                </summary>
                <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-slate-700">
                  <p><span className="font-medium">Notes:</span> {r.note}</p>
                  <p className="break-words"><span className="font-medium">Sources:</span> {r.sources.length ? r.sources.join(", ") : "none recorded"}</p>
                  {r.previousWording && <div><p className="font-medium">Wording reviewed</p><div className="mt-1 rounded-lg bg-slate-50 p-3"><WordingView w={r.previousWording} /></div></div>}
                  {r.updatedWording && JSON.stringify(r.updatedWording) !== JSON.stringify(r.previousWording) && <div><p className="font-medium">Updated wording</p><div className="mt-1 rounded-lg bg-accent-50/50 p-3"><WordingView w={r.updatedWording} /></div></div>}
                </div>
              </details>
            ))}
            {versions.length > 0 && <p className="text-xs text-slate-500">Published versions: {versions.map((v) => `v${v.version} (${when(v.publishedAt)})`).join(", ")}. The catalog's original version {rule.version} is kept.</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function WordingView({ w, highlight = [] }: { w: Wording; highlight?: Array<keyof Wording> }) {
  const mark = (k: keyof Wording) => (highlight.includes(k) ? "border-l-2 border-highlight-400 pl-2" : "");
  return (
    <div className="space-y-2 text-sm text-slate-800">
      <p className={`font-semibold ${mark("title")}`}>{w.title}</p>
      <ol className={`list-decimal space-y-1 pl-5 ${mark("requiredAction")}`}>{w.requiredAction.map((a) => <li key={a}>{a}</li>)}</ol>
      <p className={mark("purpose")}><span className="font-medium text-slate-600">Reason:</span> {w.purpose}</p>
      <p className={mark("applicability")}><span className="font-medium text-slate-600">Applicability:</span> {w.applicability}</p>
      <p className={mark("documentation")}><span className="font-medium text-slate-600">Documentation:</span> {w.documentation.join("; ")}</p>
      <p className={mark("exceptions")}><span className="font-medium text-slate-600">Exceptions:</span> {w.exceptions}</p>
      <p className={mark("verification")}><span className="font-medium text-slate-600">How to verify:</span> {w.verification}</p>
      <p className={`break-words ${mark("sources")}`}>
        <span className="font-medium text-slate-600">Citations:</span>{" "}
        {w.sources.map((s, k) => <span key={s.citation + k}>{k > 0 && "; "}{s.url.startsWith("https://") ? <a className="text-brand-700 underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.citation}</a> : s.citation}</span>)}
      </p>
    </div>
  );
}
