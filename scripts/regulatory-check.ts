/**
 * Regulatory Intelligence — run a monitoring check now.
 *
 *   npm.cmd run reg:check                       both sources
 *   npm.cmd run reg:check -- --source ecfr      eCFR only
 *   npm.cmd run reg:check -- --source fr        Federal Register only
 *   npm.cmd run reg:check -- --dry-run          contact the sources and report, but write nothing
 *
 * Contacts only www.ecfr.gov and www.federalregister.gov (official APIs), one request at a
 * time with retries. Stores section text and adds rows to the detected-change queue.
 * It cannot modify, approve or publish any compliance content.
 *
 * This is a manual run. Nothing schedules it yet.
 */
import { PrismaClient } from "@prisma/client";
import { CATALOG_CHECKED_AGAINST_ECFR_ISSUE } from "../src/lib/rules/catalog/util";
import { defaultWindow, runMonitor, type MonitorStore, type RunReport, type SourceKey } from "../src/lib/regulatory/monitor";
import { prismaMonitorStore } from "../src/lib/regulatory/prisma-store";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sourceArg = args[args.indexOf("--source") + 1]?.toLowerCase();
const sources: SourceKey[] | undefined = !args.includes("--source") ? undefined : sourceArg === "ecfr" ? ["ECFR"] : sourceArg === "fr" ? ["FEDERAL_REGISTER"] : undefined;
if (args.includes("--source") && !sources) {
  console.error("Usage: --source ecfr | fr");
  process.exit(1);
}

const prisma = new PrismaClient();

/** Reads go to the database; writes are swallowed. No lock is taken. */
function readOnly(store: MonitorStore): MonitorStore {
  let n = 0;
  return {
    ...store,
    acquireLock: async () => true,
    releaseLock: async () => {},
    startRun: async () => "dry-run",
    finishRun: async () => {},
    markSource: async () => {},
    saveVersion: async () => ({ id: `dry-${n++}`, created: true }),
    markChecked: async () => {},
    addChange: async () => true,
  };
}

function print(r: RunReport) {
  const d = r.details as Record<string, any>;
  console.log(`\n── ${r.source} ── ${r.status}${r.error ? ` — ${r.error}` : ""}`);
  if (r.status === "SKIPPED_LOCKED") return;
  console.log(`requests ${d.http?.requests ?? 0}, retries ${d.http?.retries ?? 0}, failed requests ${d.http?.failures ?? 0}`);
  if (r.source === "ECFR") {
    console.log(`eCFR issue date ${d.ecfrIssueDate} · sections checked ${r.provisionsChecked} of ${d.monitored}`);
    console.log(`baseline stored ${d.baselineEstablished} · unchanged ${d.unchanged} · text changed ${d.textChanged?.length ?? 0} · amended but same text ${d.amendedButSameText?.length ?? 0} · removed ${d.removed?.length ?? 0}`);
    for (const c of d.textChanged ?? []) console.log(`  CHANGED § ${c.section}: ${c.from} → ${c.to}`);
    for (const s of d.removed ?? []) console.log(`  REMOVED § ${s}`);
    for (const f of d.failures ?? []) console.log(`  NOT CHECKED § ${f.section}: ${f.error}`);
  } else {
    for (const q of d.queries ?? []) console.log(`query: ${q.label} — ${q.read} of ${q.total} read`);
    console.log(`stored ${d.stored?.length ?? 0} (${r.changesDetected} new, ${d.alreadyRecorded ?? 0} already recorded) · skipped ${d.skipped?.length ?? 0}`);
    for (const s of d.stored ?? []) console.log(`  ${s.new ? "NEW " : "seen"} ${s.id} ${s.type} · ${s.legalStatus} · parts ${s.parts.join(", ") || "—"}`);
    for (const [reason, count] of Object.entries(d.skippedCounts ?? {})) console.log(`  skipped ${count} × ${reason}`);
  }
  if (d.note) console.log(`NOTE: ${d.note}`);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const base = prismaMonitorStore(prisma);
  const reports = await runMonitor(dryRun ? readOnly(base) : base, { trigger: "MANUAL", sources, today, ...defaultWindow(CATALOG_CHECKED_AGAINST_ECFR_ISSUE, today) });
  for (const r of reports) print(r);
  console.log(dryRun ? "\nDry run — nothing was written." : "\nRun recorded in the monitoring log. Detected changes await administrator review; nothing was modified or published.");
  if (reports.some((r) => r.status === "FAILED")) process.exitCode = 2;
  else if (reports.some((r) => r.status === "PARTIAL" || r.status === "SKIPPED_LOCKED")) process.exitCode = 3;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
