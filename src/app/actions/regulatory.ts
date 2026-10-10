"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/auth/rbac";
import { CATALOG_CHECKED_AGAINST_ECFR_ISSUE } from "@/lib/rules/catalog/util";
import { defaultWindow, runMonitor } from "@/lib/regulatory/monitor";
import { prismaMonitorStore } from "@/lib/regulatory/prisma-store";

export type RunCheckResult = { ok: true; message: string } | { ok: false; error: string };

/** Minimum time between manually triggered runs — protects the official sources from repeated clicks. */
const MIN_INTERVAL_MS = 2 * 60_000;

/**
 * Manually trigger a monitoring run. Platform administrators only — enforced here on the
 * server, not by the button being hidden. A run can only read sources, store text and add
 * rows to the review queue; it cannot change or publish compliance content.
 */
export async function runRegulatoryCheckAction(): Promise<RunCheckResult> {
  const user = await getCurrentUser();
  if (!user || !isPlatformAdmin(user)) return { ok: false, error: "Not authorized." };

  const last = await prisma.monitorRun.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } });
  if (last && Date.now() - last.startedAt.getTime() < MIN_INTERVAL_MS)
    return { ok: false, error: last.status === "RUNNING" ? "A check is already running." : "A check ran less than two minutes ago. Please wait before running another." };

  await prisma.auditLog.create({ data: { orgId: user.orgId, actorId: user.id, action: "regulatory.check.manual", entityType: "MonitorRun", meta: { via: "dashboard" } } });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const reports = await runMonitor(prismaMonitorStore(prisma), { trigger: "MANUAL", triggeredById: user.id, today, ...defaultWindow(CATALOG_CHECKED_AGAINST_ECFR_ISSUE, today) });
    revalidatePath("/admin/regulatory");
    const parts = reports.map((r) => `${r.source === "ECFR" ? "eCFR" : "Federal Register"}: ${r.status.toLowerCase().replace("_", " ")}${r.source === "ECFR" ? `, ${r.provisionsChecked} sections checked` : ""}, ${r.changesDetected} new item${r.changesDetected === 1 ? "" : "s"}${r.error ? ` (${r.error})` : ""}`);
    const bad = reports.some((r) => r.status !== "SUCCEEDED");
    return bad ? { ok: false, error: parts.join(" · ") } : { ok: true, message: parts.join(" · ") };
  } catch (e) {
    console.error(e);
    revalidatePath("/admin/regulatory");
    return { ok: false, error: "The check could not be completed. See the monitoring run log." };
  }
}
