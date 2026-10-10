import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { can, SENSITIVE_CATEGORIES } from "@/lib/auth/rbac";
import { Badge, Card, PageHeader } from "@/components/ui";

export default async function DocumentsPage() {
  const { user, r } = await requireTenant("document:read");
  const docs = await r.list("document", { deletedAt: null }, { orderBy: { createdAt: "desc" }, take: 200, include: { driver: { select: { firstName: true, lastName: true } }, item: { select: { title: true, runId: true } } } });
  const sensitiveOk = can(user.role, "document:read_sensitive");
  return (
    <>
      <PageHeader title="Documents" subtitle="Files are encrypted at rest, versioned when re-uploaded to the same requirement, and every download is logged. Drug & alcohol and investigation-history records are visible only to safety and compliance roles." />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr><th className="px-5 py-3">File</th><th className="px-5 py-3">Record type</th><th className="px-5 py-3">Driver</th><th className="px-5 py-3">Requirement</th><th className="px-5 py-3">Expires</th><th className="px-5 py-3">Uploaded</th></tr>
          </thead>
          <tbody>
            {docs.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-slate-500">No documents yet. Upload evidence from a checklist item or a driver profile.</td></tr>}
            {docs.map((d: any) => {
              const restricted = SENSITIVE_CATEGORIES.has(d.recordCategory) && !sensitiveOk;
              return (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="px-5 py-3">{restricted ? <span className="text-slate-400">Restricted</span> : <a className="text-brand-700 underline" href={`/api/documents/${d.id}`}>{d.filename}</a>} <span className="text-xs text-slate-400">v{d.version}</span></td>
                  <td className="px-5 py-3"><Badge tone={SENSITIVE_CATEGORIES.has(d.recordCategory) ? "purple" : "slate"}>{d.recordCategory.replaceAll("_", " ").toLowerCase()}</Badge></td>
                  <td className="px-5 py-3">{d.driver ? `${d.driver.firstName} ${d.driver.lastName}` : "—"}</td>
                  <td className="px-5 py-3">{d.item ? <Link className="text-brand-700" href={`/runs/${d.item.runId}`}>{d.item.title}</Link> : "—"}</td>
                  <td className="px-5 py-3">{d.expiresOn ? new Date(d.expiresOn).toLocaleDateString() : "—"}</td>
                  <td className="px-5 py-3">{new Date(d.createdAt).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Retention scheduling and deletion workflows are planned for Phase 2; nothing is auto-deleted today.</p>
    </>
  );
}
