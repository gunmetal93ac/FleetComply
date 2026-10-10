import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { WORKFLOWS } from "@/lib/workflows/definitions";
import type { WorkflowKey } from "@/lib/rules/types";

export default async function RunsPage() {
  const { r } = await requireTenant();
  const runs = await r.list("workflowRun", {}, { orderBy: { createdAt: "desc" }, include: { items: { select: { status: true, classification: true, blocksSafetySensitive: true } } } });
  return (
    <>
      <PageHeader title="Saved checklists" subtitle="Tracked compliance checklists your team has saved — with assignments, evidence, verification and approval." actions={<Link href="/"><Button>Find a scenario</Button></Link>} />
      <Card>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr><th className="px-5 py-3">Workflow</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Open blockers</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Started</th></tr>
          </thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-slate-500">No workflows yet.</td></tr>}
            {runs.map((run: any) => {
              const blockers = run.items.filter((i: any) => i.blocksSafetySensitive && i.status !== "COMPLETED" && i.status !== "NOT_APPLICABLE").length;
              return (
                <tr key={run.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3"><Link className="font-medium text-brand-700" href={`/runs/${run.id}`}>{run.title}</Link></td>
                  <td className="px-5 py-3 text-slate-600">{WORKFLOWS[run.workflowKey as WorkflowKey]?.title ?? run.workflowKey}</td>
                  <td className="px-5 py-3">{blockers ? <Badge tone="red">{blockers}</Badge> : <Badge tone="green">0</Badge>}</td>
                  <td className="px-5 py-3">{run.status === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge tone="blue">Active</Badge>}</td>
                  <td className="px-5 py-3 text-slate-600">{new Date(run.createdAt).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
