/**
 * Regulatory Verification — command-line helper.
 *
 *   npm.cmd run reg:verify -- --list                     show the verification queue
 *   npm.cmd run reg:verify -- <ruleId> --draft <file>    load a prepared draft correction (JSON) for that step
 *   npm.cmd run reg:verify -- <ruleId> --check           retrieve the step's cited sections from the official eCFR
 *   npm.cmd run reg:verify -- <ruleId> --check --monitor also add the active sections of its range / subpart citations, and
 *                                                        sections cited individually, to Regulatory Intelligence monitoring
 *                                                        (never sections of a part-level citation, never reserved ones)
 *
 * What it cannot do: approve, reject or publish. Those are administrator decisions and exist only
 * in the dashboard, behind the platform-administrator check. A draft loaded here is labelled as a
 * prepared draft, is not visible to customers, and has no effect until an administrator approves
 * and then publishes it.
 *
 * Actions are recorded in the audit log against the platform administrator named by --as <email>
 * (default: the first platform administrator).
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ecfrFetcher, prismaVerificationStore } from "../src/lib/regulatory/verification-store";
import { buildQueue, monitorCoverage, runSourceCheck, saveProposedCorrection, STATUS_LABEL, type Actor, type Wording } from "../src/lib/regulatory/verification";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const ruleId = args.find((a, i) => !a.startsWith("--") && !["--draft", "--as"].includes(args[i - 1] ?? ""));
const prisma = new PrismaClient();

async function actor(): Promise<Actor> {
  const email = value("--as");
  const u = await prisma.user.findFirst({ where: { platformAdmin: true, disabled: false, ...(email ? { email } : {}) }, orderBy: { createdAt: "asc" } });
  if (!u) throw new Error("No platform administrator found. Grant one with: npm.cmd run admin:grant -- <email>");
  return { id: u.id, orgId: u.orgId, platformAdmin: true };
}

async function main() {
  const store = prismaVerificationStore(prisma);

  if (flag("--list") || !ruleId) {
    const queue = buildQueue(await store.listStates(), await store.listCorrectionVersions());
    for (const i of queue)
      console.log(`${i.priority.level.padEnd(7)} ${STATUS_LABEL[i.status].padEnd(34)} ${i.rule.id}${i.findings.some((f) => f.severity !== "INFO") ? "  [possible citation issue]" : ""}`);
    const by = (s: string) => queue.filter((i) => i.status === s).length;
    console.log(`\n${queue.length} steps · ${by("REVIEW_REQUIRED")} review required · ${by("NOT_REVIEWED")} not yet reviewed · ${queue.filter((i) => i.safetySensitive).length} safety-sensitive`);
    return;
  }

  const who = await actor();
  const draftFile = value("--draft");
  if (draftFile) {
    const parsed = JSON.parse(readFileSync(draftFile, "utf8")) as { ruleId: string; wording: Wording };
    if (parsed.ruleId !== ruleId) throw new Error(`The draft is for ${parsed.ruleId}, not ${ruleId}.`);
    const state = await saveProposedCorrection(store, who, ruleId, parsed.wording, { proposedBy: "system-draft" });
    console.log(`Draft correction saved for ${ruleId}. Status: ${STATUS_LABEL[state.status]}. It is not approved and not visible to customers.`);
  }

  if (flag("--check")) {
    const check = await runSourceCheck(store, ecfrFetcher(), who, ruleId);
    console.log(`Source check: ${check.outcome} · eCFR issue ${check.issueDate ?? "—"} · ${check.requests} request(s)`);
    for (const s of check.sections)
      console.log(`  § ${s.section.padEnd(8)} ${!s.exists ? "NOT FOUND" : s.removed ? "REMOVED" : s.reserved ? "RESERVED" : s.textHash ? `retrieved (${s.textLength} chars, amended ${s.lastAmended})` : `NOT RETRIEVED — ${s.error}`}  ${s.heading ?? ""}  [${s.origin.toLowerCase()}]`);
    for (const g of check.coverage) console.log(`  coverage of "${g.citation}" [${g.kind.toLowerCase()}, ${g.origin.toLowerCase()}]: ${g.sections.map((s) => `${s.section}${s.activity === "ACTIVE" ? "" : `(${s.activity.toLowerCase()})`}${s.monitored ? "*" : ""}`).join(" ")}   (* = monitored)`);
    for (const f of check.findings) console.log(`  ${f.severity.padEnd(8)} [${f.appliesTo.toLowerCase()}] ${f.key}\n           ${f.message}\n           next: ${f.nextAction}`);
    if (flag("--monitor")) {
      const wanted = [...new Set([...check.coverage.flatMap((g) => g.sections.filter((s) => s.suggested && !s.monitored).map((s) => s.section)), ...check.unmonitored])];
      const added = wanted.length ? await monitorCoverage(store, who, ruleId, wanted) : [];
      console.log(added.length ? `Added to monitoring for this step: § ${added.join(", § ")}. Each gets a baseline at the next monitoring check.` : "Nothing to add to monitoring.");
    }
    const state = await store.getState(ruleId);
    console.log(`Status: ${STATUS_LABEL[state!.status]}. Retrieval is evidence only — nothing was approved or published.`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
