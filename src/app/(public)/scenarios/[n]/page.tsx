import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Alert, Badge, Card, CardBody } from "@/components/ui";
import { getScenario, guideCategory } from "@/lib/workflows/scenarios";
import { scenarioHref } from "@/lib/workflows/slugs";
import { searchScenarios } from "@/lib/search/scenario-search";
import { CATEGORY_THEME, CategoryIcon } from "@/components/guide/category-theme";
import { IconArrowLeft, IconArrowRight } from "@/components/icons";

/** eCFR link for a "49 CFR Part N" or "49 CFR N.N" reference; null for anything else (IRP, state law…). */
function ecfrLink(ref: string): string | null {
  const part = ref.match(/^49 CFR Parts? (\d+)/);
  if (part) return `https://www.ecfr.gov/current/title-49/part-${part[1]}`;
  const section = ref.match(/^49 CFR (\d+\.\d+)/);
  if (section) return `https://www.ecfr.gov/current/title-49/section-${section[1]}`;
  return null;
}

/** A scenario without a verified workflow. Shown honestly — no steps are generated. */
export default async function ScenarioPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const s = getScenario(n);
  if (!s) notFound();
  if (s.status === "LIVE" || s.aliasOf !== undefined) redirect(scenarioHref(s));

  const related = searchScenarios(s.title, 10).filter((r) => r.scenario.status === "LIVE").slice(0, 3);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-brand-700">
        <IconArrowLeft className="h-4 w-4" /> New search
      </Link>
      <header className="flex items-start gap-4 pb-2">
        <CategoryIcon category={guideCategory(s)} size="lg" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{CATEGORY_THEME[guideCategory(s)].short}</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-navy-800 sm:text-3xl">{s.title}</h1>
          <p className="mt-2 text-slate-600">{s.determines}</p>
        </div>
      </header>

      <Alert tone="amber" title="No verified workflow yet">
        FleetComply hasn’t finished researching this scenario against the official regulations, so it doesn’t show step-by-step instructions for it. Rather
        than guess, it shows where the research starts. Confirm the requirements with FMCSA, the eCFR, or your state agency before you act.
      </Alert>

      {s.regulatoryAreas && s.regulatoryAreas.length > 0 && (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Regulatory starting points</h2>
              <Badge tone="amber">Requires Regulatory Verification</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              These are the areas of regulation that research for this scenario begins with. They are not a list of requirements and may not be complete.
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {s.regulatoryAreas.map((ref) => {
                const url = ecfrLink(ref);
                return (
                  <li key={ref}>
                    {url ? <a className="text-brand-700 underline" href={url} target="_blank" rel="noreferrer noopener">{ref}</a> : ref}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-2 text-sm">
          <h2 className="font-semibold">Official sources</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><a className="text-brand-700 underline" href="https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III" target="_blank" rel="noreferrer noopener">eCFR — 49 CFR Chapter III (FMCSA regulations)</a></li>
            <li><a className="text-brand-700 underline" href="https://www.fmcsa.dot.gov/regulations" target="_blank" rel="noreferrer noopener">FMCSA — Regulations</a></li>
          </ul>
        </CardBody>
      </Card>

      {related.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Related step-by-step guides</h2>
          <ul className="space-y-2">
            {related.map(({ scenario: r }) => (
              <li key={r.n}>
                <Link href={scenarioHref(r)} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift">
                  <CategoryIcon category={guideCategory(r)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-navy-800 group-hover:text-brand-700">{r.title}</p>
                    <p className="text-sm text-slate-500">{r.determines}</p>
                  </div>
                  <IconArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Related guides cover a different situation. Use them only where they actually apply to yours.</p>
        </div>
      )}
    </div>
  );
}
