import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { repo } from "@/lib/db";
import { loadRun } from "@/lib/runs";
import { CLASSIFICATION_LABEL } from "@/lib/rules/labels";
import { STATUS_LABEL } from "@/lib/workflows/status";

const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralize spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const r = repo(user.orgId);
  let data;
  try {
    data = await loadRun(r, id);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const header = ["Stage", "Requirement", "Classification", "Status", "Blocks safety-sensitive", "Due", "Citations", "Source verification", "Rule id", "Rule version", "Documents", "Completion date", "Verified at", "N/A reason", "Notes"];
  const rows = data.items.map((i) => [
    i.stage, i.title, CLASSIFICATION_LABEL[i.classification], STATUS_LABEL[i.status], i.blocksSafetySensitive ? "Yes" : "No",
    i.dueAt?.toISOString() ?? "", i.ruleSnapshot.sources.map((s) => s.citation).join("; "), i.ruleSnapshot.verificationStatus,
    i.ruleId, i.ruleVersion, i.documents.map((d) => d.filename).join("; "), i.completionDate ?? "", i.verifiedAt?.toISOString() ?? "", i.naReason ?? "", i.notes ?? "",
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  await r.create("auditLog", { actorId: user.id, action: "run.export_csv", entityType: "WorkflowRun", entityId: id });
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fleetcomply-${id}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
