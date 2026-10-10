import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth/session";
import { loadRun } from "@/lib/runs";
import { APPROVAL_DISCLAIMER } from "@/lib/workflows/review";
import { STATUS_LABEL } from "@/lib/workflows/status";
import { CLASSIFICATION_LABEL } from "@/lib/rules/labels";
import { PrintButton } from "@/components/app/PrintButton";
import { Alert, Button } from "@/components/ui";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, r } = await requireTenant();
  const { run, items, summary } = await loadRun(r, id);
  const users = await prisma.user.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true } });
  const name = (uid: string | null) => (uid ? users.find((u) => u.id === uid)?.name ?? "Former user" : "—");
  const now = new Date();

  const applicable = items.filter((i) => i.classification !== "NOT_APPLICABLE");
  const groups: Array<[string, typeof items]> = [
    ["Completed (verified)", applicable.filter((i) => i.status === "COMPLETED")],
    ["Awaiting verification", applicable.filter((i) => i.status === "PENDING_VERIFICATION")],
    ["Missing / incomplete", applicable.filter((i) => ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"].includes(i.status))],
    ["Marked not applicable by a user", applicable.filter((i) => i.status === "NOT_APPLICABLE")],
  ];

  return (
    <article className="mx-auto max-w-5xl bg-white p-8 text-sm shadow-sm print:p-0 print:shadow-none">
      <div className="no-print mb-6 flex gap-2">
        <Link href={`/runs/${id}`}><Button variant="outline" size="sm">← Back to checklist</Button></Link>
        <PrintButton />
        <a href={`/api/runs/${id}/export`}><Button variant="outline" size="sm">CSV</Button></a>
      </div>

      <header className="border-b border-slate-200 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">FleetComply compliance report</p>
        <h1 className="mt-1 text-xl font-bold">{run.title}</h1>
        <p className="text-slate-600">
          {user.org.name}{user.org.isSample && " — SAMPLE COMPANY, FICTIONAL DATA"} · generated {now.toLocaleString()} by {user.name} · rule catalog {run.catalogVersion}
        </p>
      </header>

      <section className="mt-4 grid gap-2 sm:grid-cols-4">
        <Stat label="Required items resolved" value={`${summary.resolved} / ${summary.mustResolve}`} />
        <Stat label="Blocking items open" value={String(summary.blockersOutstanding.length)} />
        <Stat label="Overdue" value={String(summary.overdue.length)} />
        <Stat label="Status" value={run.status === "APPROVED" ? "Approved" : "In progress"} />
      </section>

      {summary.issues.length > 0 && (
        <section className="mt-4">
          <h2 className="font-semibold">Potential compliance issues</h2>
          <ul className="mt-1 list-disc pl-5 text-red-800">{summary.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </section>
      )}

      {((run.warnings as string[]) ?? []).length > 0 && (
        <section className="mt-4">
          <h2 className="font-semibold">Situation notes</h2>
          <ul className="mt-1 list-disc pl-5">{(run.warnings as string[]).map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}

      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title} className="mt-6 break-inside-avoid-page">
            <h2 className="mb-2 font-semibold">{title} ({list.length})</h2>
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-300 text-slate-500">
                  <th className="py-1 pr-2">Requirement</th>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">Citation</th>
                  <th className="py-1 pr-2">Evidence</th>
                  <th className="py-1 pr-2">Status / verification</th>
                </tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className="border-b border-slate-100 align-top">
                    <td className="py-1.5 pr-2">
                      <p className="font-medium">{i.title}</p>
                      {i.blocksSafetySensitive && <p className="text-red-700">Blocks safety-sensitive work</p>}
                      {i.ruleSnapshot.verificationStatus === "REQUIRES_VERIFICATION" && <p className="text-amber-700">Requires Regulatory Verification</p>}
                    </td>
                    <td className="py-1.5 pr-2">{CLASSIFICATION_LABEL[i.classification]}</td>
                    <td className="py-1.5 pr-2">{i.ruleSnapshot.sources.map((s) => s.citation).join("; ")}</td>
                    <td className="py-1.5 pr-2">{i.documents.length ? i.documents.map((d) => `${d.filename} (v${d.version})`).join(", ") : i.completionDate ? `Note only (${i.completionDate})` : "—"}</td>
                    <td className="py-1.5 pr-2">
                      {STATUS_LABEL[i.status]}
                      {i.verifiedById && <> · verified by {name(i.verifiedById)} {i.verifiedAt?.toLocaleDateString()}</>}
                      {i.naReason && <> · reason: {i.naReason}</>}
                      {i.dueAt && i.status !== "COMPLETED" && <> · due {i.dueAt.toLocaleDateString()}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null,
      )}

      <section className="mt-6">
        <h2 className="font-semibold">Determined not applicable by the rules engine ({items.length - applicable.length})</h2>
        <p className="text-slate-600">{items.filter((i) => i.classification === "NOT_APPLICABLE").map((i) => i.title).join(" · ") || "None"}</p>
      </section>

      <section className="mt-6 border-t border-slate-200 pt-4">
        <h2 className="font-semibold">Reviewer and approval</h2>
        {run.status === "APPROVED" ? (
          <p>Approved by {name(run.approvedById)} on {run.approvedAt?.toLocaleString()}. Review note: “{run.approvalNote}”</p>
        ) : (
          <p>Not yet approved.</p>
        )}
        <div className="mt-3"><Alert tone="slate">{APPROVAL_DISCLAIMER} FleetComply explains regulations; it does not provide legal advice.</Alert></div>
      </section>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
