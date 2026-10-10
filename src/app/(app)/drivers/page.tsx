import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { SampleBadge } from "@/components/badges";

const DAY = 86_400_000;
function expiryBadge(d: Date | null) {
  if (!d) return <Badge>Not recorded</Badge>;
  const days = Math.ceil((d.getTime() - Date.now()) / DAY);
  if (days < 0) return <Badge tone="red">Expired</Badge>;
  return <Badge tone={days <= 30 ? "amber" : "green"}>{d.toLocaleDateString()}</Badge>;
}

export default async function DriversPage() {
  const { user, r } = await requireTenant("driver:read");
  const drivers = await r.list("driver", {}, { orderBy: [{ status: "asc" }, { lastName: "asc" }] });
  return (
    <>
      <PageHeader title="Drivers" actions={can(user.role, "driver:write") && <Link href="/drivers/new"><Button>Add driver</Button></Link>} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">CDL</th><th className="px-5 py-3">CDL expires</th><th className="px-5 py-3">Medical cert expires</th></tr>
          </thead>
          <tbody>
            {drivers.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-slate-500">No drivers yet. Start the “Hire a new CDL driver” workflow or add one here.</td></tr>}
            {drivers.map((d: any) => (
              <tr key={d.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3"><Link href={`/drivers/${d.id}`} className="font-medium text-brand-700">{d.lastName}, {d.firstName}</Link> {d.isSample && <SampleBadge />}</td>
                <td className="px-5 py-3 capitalize">{d.status.toLowerCase()}</td>
                <td className="px-5 py-3">{d.cdlClass ? `Class ${d.cdlClass}` : "—"} {d.cdlState ?? ""} {d.endorsements?.length ? `· ${d.endorsements.join("")}` : ""}</td>
                <td className="px-5 py-3">{expiryBadge(d.cdlExpiresOn)}</td>
                <td className="px-5 py-3">{expiryBadge(d.medCertExpiresOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
