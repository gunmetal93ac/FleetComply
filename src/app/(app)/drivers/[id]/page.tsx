import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { updateDriverAction } from "@/app/actions/drivers";
import { DriverForm } from "@/components/drivers/DriverForm";
import { DriverDocUpload } from "@/components/drivers/DriverDocUpload";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { SampleBadge } from "@/components/badges";
import { KEY_TO_SLUG } from "@/lib/workflows/slugs";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, r } = await requireTenant("driver:read");
  const d = await r.findMaybe("driver", { id });
  if (!d) notFound();
  const [runs, docs] = await Promise.all([
    r.list("workflowRun", { driverId: id }, { orderBy: { createdAt: "desc" } }),
    r.list("document", { driverId: id, deletedAt: null }, { orderBy: { createdAt: "desc" } }),
  ]);
  const canSensitive = can(user.role, "document:read_sensitive");
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/drivers" className="text-brand-700">← Drivers</Link></p>
      <PageHeader
        title={`${d.firstName} ${d.lastName}`}
        subtitle={d.isSample ? <SampleBadge /> : undefined}
        actions={
          <>
            <Link href={`/workflows/${KEY_TO_SLUG.DOT_ACCIDENT_RESPONSE}/start`}><Button size="sm" variant="outline">Report an accident</Button></Link>
            <Link href={`/workflows/${KEY_TO_SLUG.DRUG_ALCOHOL_VIOLATION}/start`}><Button size="sm" variant="outline">Drug/alcohol violation</Button></Link>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardBody>
            {can(user.role, "driver:write") ? (
              <DriverForm
                action={updateDriverAction.bind(null, d.id)}
                submitLabel="Save changes"
                initial={{
                  firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, status: d.status,
                  cdlState: d.cdlState, cdlClass: d.cdlClass, cdlNumberLast4: d.cdlNumberLast4, endorsements: d.endorsements,
                  cdlExpiresOn: iso(d.cdlExpiresOn), medCertExpiresOn: iso(d.medCertExpiresOn), hireDate: iso(d.hireDate),
                }}
              />
            ) : (
              <p className="text-sm text-slate-600">Read-only access.</p>
            )}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Workflows</CardTitle></CardHeader>
            <CardBody className="space-y-2 text-sm">
              {runs.length === 0 && <p className="text-slate-500">None yet.</p>}
              {runs.map((run: any) => (
                <div key={run.id} className="flex items-center justify-between gap-2">
                  <Link href={`/runs/${run.id}`} className="text-brand-700">{run.title}</Link>
                  {run.status === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge tone="blue">Active</Badge>}
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
            <CardBody className="space-y-2 text-sm">
              {docs.length === 0 && <p className="text-slate-500">None yet.</p>}
              {docs.map((doc: any) => {
                const restricted = ["DRUG_ALCOHOL_PROGRAM", "DRIVER_INVESTIGATION_HISTORY_FILE"].includes(doc.recordCategory) && !canSensitive;
                return (
                  <div key={doc.id}>
                    {restricted ? <span className="text-slate-500">Restricted record</span> : <a className="text-brand-700 underline" href={`/api/documents/${doc.id}`}>{doc.filename}</a>}
                    <p className="text-xs text-slate-500">{doc.recordCategory.replaceAll("_", " ").toLowerCase()} · v{doc.version} · {doc.createdAt.toLocaleDateString()}{doc.expiresOn ? ` · expires ${doc.expiresOn.toLocaleDateString()}` : ""}</p>
                  </div>
                );
              })}
              {can(user.role, "document:upload") && <DriverDocUpload driverId={d.id} />}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
