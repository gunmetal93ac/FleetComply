import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { Badge, Card, CardBody, PageHeader } from "@/components/ui";

export default async function ReportsPage() {
  const { r } = await requireTenant();
  const runs = await r.list("workflowRun", {}, { orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader title="Reports" subtitle="Audit-ready report for each workflow: every applicable requirement, its evidence, verification status and citation. Print to PDF from the report page, or export CSV." />
      <Card>
        <CardBody className="space-y-2 text-sm">
          {runs.length === 0 && <p className="text-slate-500">No workflows yet.</p>}
          {runs.map((run: any) => (
            <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <span>{run.title}</span>
              <span className="flex items-center gap-3">
                {run.status === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge tone="blue">Active</Badge>}
                <Link className="text-brand-700" href={`/runs/${run.id}/report`}>Report</Link>
                <a className="text-brand-700" href={`/api/runs/${run.id}/export`}>CSV</a>
              </span>
            </div>
          ))}
        </CardBody>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Fleet-wide reports (DQ file review across all drivers, missing documents, vehicle maintenance, internal audit findings) are planned for Phase 3.</p>
    </>
  );
}
