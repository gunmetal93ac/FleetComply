import Link from "next/link";
import { Badge, Card, CardBody, PageHeader } from "@/components/ui";
import { CATEGORIES, SCENARIOS } from "@/lib/workflows/scenarios";
import { KEY_TO_SLUG } from "@/lib/workflows/slugs";
import { requireUser } from "@/lib/auth/session";

export default async function WorkflowsPage() {
  await requireUser();
  const live = SCENARIOS.filter((s) => s.status === "LIVE").length;
  return (
    <>
      <PageHeader
        title="What are you trying to accomplish?"
        subtitle={`Pick a situation. Live workflows ask a few questions and build a checklist for your exact case. ${live} of ${SCENARIOS.length} scenarios are live; the rest are listed so you can see what's coming — they don't produce checklists yet.`}
      />
      <div className="space-y-8">
        {CATEGORIES.map((cat) => (
          <section key={cat}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{cat}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {SCENARIOS.filter((s) => s.category === cat).map((s) => {
                const body = (
                  <Card className={s.status === "LIVE" ? "h-full transition hover:border-brand-500 hover:shadow" : "h-full bg-slate-50"}>
                    <CardBody>
                      <div className="flex items-start justify-between gap-2">
                        <p className={s.status === "LIVE" ? "font-medium text-slate-900" : "font-medium text-slate-500"}>{s.title}</p>
                        {s.status === "LIVE" ? <Badge tone="green">Live</Badge> : <Badge>Planned · Phase {s.phase}</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{s.determines}</p>
                      {s.status === "PLANNED" && s.regulatoryAreas && (
                        <p className="mt-2 text-xs text-slate-400">Research starting points (not yet verified): {s.regulatoryAreas.join("; ")}</p>
                      )}
                    </CardBody>
                  </Card>
                );
                return s.status === "LIVE" ? (
                  <Link key={s.n} href={`/workflows/${KEY_TO_SLUG[s.workflow!]}/start?scenario=${s.n}`} className="block">
                    {body}
                  </Link>
                ) : (
                  <div key={s.n} aria-disabled="true">{body}</div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
