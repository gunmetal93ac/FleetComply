import Link from "next/link";
import { notFound } from "next/navigation";
import { ComplianceGuide } from "@/components/guide/ComplianceGuide";
import { CATEGORY_THEME, CategoryIcon } from "@/components/guide/category-theme";
import { IconArrowLeft } from "@/components/icons";
import { WORKFLOWS, type Answers } from "@/lib/workflows/definitions";
import { SCENARIOS, guideCategory, resolveScenario } from "@/lib/workflows/scenarios";
import { SLUG_TO_KEY } from "@/lib/workflows/slugs";
import { prisma } from "@/lib/db";
import { rulesFor } from "@/lib/rules/catalog";
import { loadPublishedOverrides } from "@/lib/regulatory/verification-store";

/** Public, step-by-step compliance guide for a live workflow. Nothing is saved to the database. */
export default async function GuidePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ scenario?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const key = SLUG_TO_KEY[slug];
  if (!key) notFound();
  const def = WORKFLOWS[key];
  const requested = SCENARIOS.find((s) => String(s.n) === sp.scenario && s.workflow === key);
  // Old links to a merged scenario show the scenario it was merged into.
  const scenario = requested && resolveScenario(requested);
  const preset: Answers = { ...(scenario?.preset ?? {}) };
  const category = scenario ? guideCategory(scenario) : null;
  // Reviewed corrections an administrator has published for this workflow's steps (usually none).
  const overrides = await loadPublishedOverrides(prisma, rulesFor(key));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/" className="no-print mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-brand-700">
        <IconArrowLeft className="h-4 w-4" /> New search
      </Link>
      <header className="mb-8 flex items-start gap-4">
        {category && <CategoryIcon category={category} size="lg" />}
        <div>
          {category && <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{CATEGORY_THEME[category].short}</p>}
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-navy-800 sm:text-3xl">{scenario?.title ?? def.title}</h1>
          <p className="mt-2 max-w-2xl text-slate-600">{def.description}</p>
        </div>
      </header>
      <ComplianceGuide
        workflowKey={key}
        preset={preset}
        overrides={overrides}
        scenario={scenario ? { n: scenario.n, title: scenario.title, determines: scenario.determines } : null}
      />
    </div>
  );
}
