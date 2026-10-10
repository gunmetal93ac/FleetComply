import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth/session";
import { readinessScore, type ReviewItem } from "@/lib/workflows/review";
import { KEY_TO_SLUG } from "@/lib/workflows/slugs";
import { WORKFLOWS } from "@/lib/workflows/definitions";
import type { Classification, RecordCategory, RegulatoryRule, WorkflowKey } from "@/lib/rules/types";
import type { ItemStatus } from "@/lib/workflows/status";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader, Select } from "@/components/ui";
import { StatusBadge } from "@/components/badges";

const DAY = 86_400_000;
const CATEGORY_LABEL: Record<RecordCategory, string> = {
  DRIVER_QUALIFICATION_FILE: "Driver qualification file",
  DRIVER_INVESTIGATION_HISTORY_FILE: "Investigation history file",
  DRUG_ALCOHOL_PROGRAM: "Drug & alcohol program",
  HAZMAT_TRAINING: "Hazmat training",
  ACCIDENT_RECORDS: "Accident records",
  GENERAL_EMPLOYMENT: "General employment (HR)",
  COMPANY_RECORDS: "Company records",
};

type Row = {
  id: string; title: string; status: ItemStatus; classification: Classification; dueAt: Date | null;
  blocksSafetySensitive: boolean; assigneeId: string | null; overrideFlag: boolean; ruleSnapshot: RegulatoryRule;
  run: { id: string; title: string; driverId: string | null; workflowKey: string }; _count: { documents: number };
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ driver?: string; category?: string; assignee?: string }> }) {
  const sp = await searchParams;
  const { user, r } = await requireTenant("dashboard:read");
  const now = new Date();

  const [drivers, team] = await Promise.all([
    r.list("driver", { status: { in: ["APPLICANT", "ACTIVE"] } }, { orderBy: { lastName: "asc" } }),
    prisma.user.findMany({ where: { orgId: user.orgId, disabled: false }, select: { id: true, name: true } }),
  ]);
  const allOpen = (await r.list<Row>("checklistItem", { run: { status: "ACTIVE" } } as any, {
    include: { run: { select: { id: true, title: true, driverId: true, workflowKey: true } }, _count: { select: { documents: true } } },
    orderBy: { dueAt: "asc" },
  })) as Row[];

  const items = allOpen.filter(
    (i) =>
      (!sp.driver || i.run.driverId === sp.driver) &&
      (!sp.category || i.ruleSnapshot.recordCategory === sp.category) &&
      (!sp.assignee || i.assigneeId === sp.assignee),
  );
  const open = items.filter((i) => i.status !== "COMPLETED" && i.status !== "NOT_APPLICABLE");
  const score = readinessScore(
    items.map<ReviewItem>((i) => ({
      id: i.id, title: i.title, classification: i.classification, status: i.status, blocksSafetySensitive: i.blocksSafetySensitive,
      dueAt: i.dueAt, verificationStatus: i.ruleSnapshot.verificationStatus, overrideFlag: i.overrideFlag, evidenceCount: i._count.documents,
    })),
    now,
  );
  const overdue = open.filter((i) => i.dueAt && i.dueAt < now);
  const upcoming = open.filter((i) => i.dueAt && i.dueAt >= now && i.dueAt.getTime() - now.getTime() < 30 * DAY);
  const dna = open.filter((i) => i.ruleSnapshot.recordCategory === "DRUG_ALCOHOL_PROGRAM");
  const undetermined = open.filter((i) => i.classification === "UNABLE_TO_DETERMINE");
  const investigations = [...new Map(allOpen.filter((i) => i.run.workflowKey === "DOT_ACCIDENT_RESPONSE").map((i) => [i.run.id, i.run])).values()];
  const expiring = (field: "medCertExpiresOn" | "cdlExpiresOn") =>
    drivers.filter((d: any) => d[field] && new Date(d[field]).getTime() - now.getTime() < 60 * DAY).sort((a: any, b: any) => +new Date(a[field]) - +new Date(b[field]));
  const dqRuns = await r.list("workflowRun", { workflowKey: "HIRE_CDL_DRIVER" }, { orderBy: { createdAt: "desc" } });
  const driverName = (id: string | null) => {
    const d = drivers.find((x: any) => x.id === id);
    return d ? `${d.firstName} ${d.lastName}` : "—";
  };

  return (
    <>
      <PageHeader
        title="Compliance dashboard"
        subtitle={user.org.isSample ? "You are viewing the SAMPLE company. All drivers and records are fictional." : undefined}
        actions={
          <>
            {(Object.keys(WORKFLOWS) as WorkflowKey[]).map((k) => (
              <Link key={k} href={`/workflows/${KEY_TO_SLUG[k]}/start`}>
                <Button size="sm" variant={k === "HIRE_CDL_DRIVER" ? "primary" : "outline"}>{WORKFLOWS[k].title.replace(/ involving one of our drivers| or other drug\/alcohol violation/, "")}</Button>
              </Link>
            ))}
          </>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm" method="get">
        <FilterSelect name="driver" label="Driver" value={sp.driver} options={drivers.map((d: any) => [d.id, `${d.lastName}, ${d.firstName}`])} />
        <FilterSelect name="category" label="Compliance category" value={sp.category} options={Object.entries(CATEGORY_LABEL)} />
        <FilterSelect name="assignee" label="Responsible person" value={sp.assignee} options={team.map((t) => [t.id, t.name])} />
        <Button size="sm" variant="outline" type="submit">Apply</Button>
        {(sp.driver || sp.category || sp.assignee) && <Link className="text-brand-700" href="/dashboard">Clear</Link>}
        <span className="text-xs text-slate-400">Vehicle, department and location filters arrive with vehicle management (Phase 2).</span>
      </form>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:row-span-2">
          <CardHeader><CardTitle>Workflow readiness score</CardTitle></CardHeader>
          <CardBody>
            <p className="text-5xl font-bold text-slate-900">{score.score}<span className="text-xl text-slate-400">/100</span></p>
            <p className="mt-3 text-xs font-semibold uppercase text-slate-500">How it's calculated</p>
            <ul className="mt-1 space-y-1 text-sm text-slate-700">{score.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
            <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">{score.disclaimer}</p>
          </CardBody>
        </Card>

        <ListCard title={`Overdue (${overdue.length})`} empty="Nothing overdue." items={overdue} tone="red" />
        <ListCard title={`Due in the next 30 days (${upcoming.length})`} empty="Nothing due soon." items={upcoming} />
        <ListCard title={`Drug & alcohol program tasks (${dna.length})`} empty="No open drug & alcohol tasks." items={dna} />
        <ListCard title={`Needs a human decision (${undetermined.length})`} empty="No undetermined items." items={undetermined} tone="amber" />

        <Card>
          <CardHeader><CardTitle>Driver qualification status</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm">
            {drivers.length === 0 && <p className="text-slate-500">No drivers yet.</p>}
            {drivers.slice(0, 8).map((d: any) => {
              const run = dqRuns.find((x: any) => x.driverId === d.id);
              return (
                <div key={d.id} className="flex items-center justify-between">
                  <Link href={`/drivers/${d.id}`} className="text-brand-700">{d.firstName} {d.lastName}</Link>
                  {!run ? <Badge>No hiring workflow</Badge> : run.status === "APPROVED" ? <Badge tone="green">Hiring reviewed</Badge> : <Link href={`/runs/${run.id}`}><Badge tone="blue">Hiring in progress</Badge></Link>}
                </div>
              );
            })}
          </CardBody>
        </Card>

        <ExpiryCard title="Medical certifications expiring ≤ 60 days" rows={expiring("medCertExpiresOn")} field="medCertExpiresOn" now={now} />
        <ExpiryCard title="CDLs expiring ≤ 60 days" rows={expiring("cdlExpiresOn")} field="cdlExpiresOn" now={now} />

        <Card>
          <CardHeader><CardTitle>Open accident investigations ({investigations.length})</CardTitle></CardHeader>
          <CardBody className="space-y-1 text-sm">
            {investigations.length === 0 ? <p className="text-slate-500">None open.</p> : investigations.map((run) => <p key={run.id}><Link className="text-brand-700" href={`/runs/${run.id}`}>{run.title}</Link></p>)}
          </CardBody>
        </Card>

        <Card className="bg-slate-50">
          <CardHeader><CardTitle className="text-slate-500">Not tracked yet</CardTitle></CardHeader>
          <CardBody className="text-sm text-slate-500">
            Annual driver reviews (Phase 2) · vehicle inspection deadlines (Phase 2) · regulatory change alerts (Phase 3). These are not counted in the score.
          </CardBody>
        </Card>
      </div>
      <p className="mt-6 text-xs text-slate-400">Showing {driverName(sp.driver ?? null) !== "—" ? `driver ${driverName(sp.driver ?? null)}` : "all drivers"}.</p>
    </>
  );
}

function FilterSelect({ name, label, value, options }: { name: string; label: string; value?: string; options: Array<[string, string]> }) {
  return (
    <label className="flex flex-col">
      <span className="text-xs text-slate-500">{label}</span>
      <Select name={name} defaultValue={value ?? ""} className="h-9 w-48 py-1">
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </label>
  );
}

function ListCard({ title, items, empty, tone }: { title: string; items: Row[]; empty: string; tone?: "red" | "amber" }) {
  return (
    <Card>
      <CardHeader><CardTitle className={tone === "red" && items.length ? "text-red-700" : tone === "amber" && items.length ? "text-amber-800" : ""}>{title}</CardTitle></CardHeader>
      <CardBody className="space-y-2 text-sm">
        {items.length === 0 && <p className="text-slate-500">{empty}</p>}
        {items.slice(0, 6).map((i) => (
          <div key={i.id}>
            <Link href={`/runs/${i.run.id}`} className="font-medium text-brand-700">{i.title}</Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
              <StatusBadge value={i.status} />
              {i.dueAt && <span>due {i.dueAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>}
              <span className="truncate">· {i.run.title}</span>
            </div>
          </div>
        ))}
        {items.length > 6 && <p className="text-xs text-slate-500">+{items.length - 6} more</p>}
      </CardBody>
    </Card>
  );
}

function ExpiryCard({ title, rows, field, now }: { title: string; rows: any[]; field: string; now: Date }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardBody className="space-y-1 text-sm">
        {rows.length === 0 && <p className="text-slate-500">None.</p>}
        {rows.map((d) => {
          const days = Math.ceil((new Date(d[field]).getTime() - now.getTime()) / DAY);
          return (
            <div key={d.id} className="flex justify-between">
              <Link href={`/drivers/${d.id}`} className="text-brand-700">{d.firstName} {d.lastName}</Link>
              {days < 0 ? <Badge tone="red">Expired {-days}d ago</Badge> : <Badge tone={days <= 7 ? "red" : days <= 30 ? "amber" : "slate"}>{days}d</Badge>}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
