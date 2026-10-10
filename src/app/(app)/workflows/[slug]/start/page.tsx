import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Questionnaire } from "@/components/workflows/Questionnaire";
import { requireTenant } from "@/lib/auth/session";
import { WORKFLOWS, type Answers } from "@/lib/workflows/definitions";
import { SCENARIOS, resolveScenario } from "@/lib/workflows/scenarios";
import { SLUG_TO_KEY } from "@/lib/workflows/slugs";

export default async function StartWorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scenario?: string; driver?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const key = SLUG_TO_KEY[slug];
  if (!key) notFound();
  const { user, r } = await requireTenant("run:create");
  const def = WORKFLOWS[key];

  const requested = SCENARIOS.find((s) => String(s.n) === sp.scenario && s.workflow === key);
  // Same resolution as the public guide, so both pages read the same answer record.
  const scenario = requested && resolveScenario(requested);
  const preset: Answers = { ...(scenario?.preset ?? {}) };
  const drivers =
    def.driver !== "create"
      ? (await r.list("driver", {}, { orderBy: { lastName: "asc" } })).map((d: any) => ({ id: d.id, name: `${d.lastName}, ${d.firstName}` }))
      : [];

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/workflows" className="text-brand-700">← All workflows</Link></p>
      <PageHeader title={scenario?.title ?? def.title} subtitle={def.description} />
      <Questionnaire
        workflowKey={key}
        preset={preset}
        drivers={drivers}
        defaultCompanyState={user.org.baseState}
        scenarioN={scenario?.n ?? null}
        orgAlcoholTesting={user.org.preEmploymentAlcoholTesting}
      />
    </>
  );
}
