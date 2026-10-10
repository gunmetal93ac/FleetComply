import { ALL_RULES, CATALOG_VERIFIED_ON, CATALOG_VERSION } from "@/lib/rules/catalog";
import { stateRegistry } from "@/lib/rules/state-registry";
import { WORKFLOWS } from "@/lib/workflows/definitions";
import { Badge, Card, CardBody, Input, PageHeader } from "@/components/ui";
import { VerificationBadge } from "@/components/badges";

const KIND_LABEL = { LEGAL: "Legal requirement", BEST_PRACTICE: "Best practice", COMPANY_POLICY: "Company policy" } as const;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().toLowerCase();
  const rules = ALL_RULES.filter((r) =>
    !q || [r.title, r.id, r.purpose, r.applicability, ...r.sources.map((s) => s.citation), ...r.requiredAction].join(" ").toLowerCase().includes(q),
  );
  const loadedStates = stateRegistry.all().filter((s) => s.status === "LOADED").length;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="Regulatory library"
        subtitle={`Rule catalog ${CATALOG_VERSION}. Title 49 entries were last checked against eCFR on or before ${CATALOG_VERIFIED_ON}; each entry shows its own date. State rule packs loaded: ${loadedStates} of 51 — state-specific items show “Unable to determine” until a pack is researched and approved.`}
      />
      <form className="mb-4 max-w-md" method="get">
        <Input name="q" defaultValue={q} placeholder="Search by topic or citation, e.g. 391.23 or Clearinghouse" />
      </form>
      <div className="space-y-3">
        {rules.map((r) => (
          <Card key={r.id}>
            <CardBody>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{r.title}</p>
                <Badge tone={r.kind === "LEGAL" ? "red" : r.kind === "COMPANY_POLICY" ? "purple" : "teal"}>{KIND_LABEL[r.kind]}</Badge>
                <VerificationBadge status={r.verificationStatus} />
                {r.blocksSafetySensitive && <Badge tone="red">Blocks safety-sensitive work</Badge>}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {r.id} · v{r.version} · {r.authority} · {r.commerceScope === "INTERSTATE_ONLY" ? "Interstate (intrastate per state adoption)" : r.commerceScope === "ALL_COMMERCE" ? "Interstate and intrastate" : "Not commerce-based"} · used in: {r.workflows.map((w) => WORKFLOWS[w].title).join(", ")}
              </p>
              <p className="mt-2 text-sm text-slate-700">{r.purpose}</p>
              <p className="mt-2 text-sm">
                {r.sources.map((s, i) => (
                  <span key={s.citation}>{i > 0 && " · "}{s.url.startsWith("http") ? <a className="text-brand-700 underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.citation}</a> : s.citation}</span>
                ))}
              </p>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-slate-600">Details, retention and version history</summary>
                <div className="mt-2 space-y-2 text-slate-700">
                  <p><strong>Deadline:</strong> {r.deadline.description}</p>
                  <p><strong>Retention:</strong> {r.retention.map((x) => `${x.record}: ${x.period}${x.citation ? ` (${x.citation})` : ""}`).join("; ")}</p>
                  <p><strong>Exceptions:</strong> {r.exceptions}</p>
                  <p><strong>Effective:</strong> {r.effectiveDate} · <strong>Last verified:</strong> {r.lastVerified ?? "not verified"}</p>
                  {r.verificationNote && <p><strong>Verification note:</strong> {r.verificationNote}</p>}
                  <ul className="list-disc pl-5 text-xs">{r.changeLog.map((c) => <li key={c.version}>v{c.version} · {c.date} — {c.note}</li>)}</ul>
                </div>
              </details>
            </CardBody>
          </Card>
        ))}
        {rules.length === 0 && <p className="text-sm text-slate-500">No matches.</p>}
      </div>
    </div>
  );
}
