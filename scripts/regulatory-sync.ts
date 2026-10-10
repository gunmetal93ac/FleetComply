/**
 * Regulatory Intelligence — sync the dependency tables from the rule catalog.
 *
 *   npm.cmd run reg:sync              apply
 *   npm.cmd run reg:sync -- --dry-run show what would change, write nothing
 *
 * Inserts missing sources, provisions, rule→provision references and rule versions,
 * and refreshes references whose citation changed. Never deletes. Safe to re-run.
 * It does not contact any regulatory source and does not mark anything as reviewed.
 */
import { PrismaClient } from "@prisma/client";
import { CATALOG_VERSION, validateCatalog } from "../src/lib/rules/catalog";
import { buildDependencyMap } from "../src/lib/regulatory/dependencies";
import { applySync, isEmptyPlan, planSync, readExistingState } from "../src/lib/regulatory/sync";

const dryRun = process.argv.includes("--dry-run");
const prisma = new PrismaClient();

async function main() {
  const problems = validateCatalog();
  if (problems.length) throw new Error(`Rule catalog failed validation — nothing was synced:\n${problems.join("\n")}`);

  const map = buildDependencyMap();
  const plan = planSync(await readExistingState(prisma), undefined, map);

  console.log(`Catalog ${CATALOG_VERSION}: ${map.provisions.length} provisions, ${map.refs.length} rule→provision references.`);
  console.log(
    `Plan: +${plan.createSources.length} sources, +${plan.createProvisions.length} provisions, +${plan.createRefs.length} references, ` +
      `${plan.updateRefs.length} references to refresh, +${plan.createRuleVersions.length} rule versions, ${plan.staleRefs.length} stale references (reported only).`,
  );
  for (const s of plan.staleRefs) console.log(`  stale: ${s.ruleId} → ${s.provisionKey} (no longer in the catalog; not deleted)`);
  for (const m of map.mismatches) console.log(`  check: ${m.ruleId} cites "${m.citation}" but links to § ${m.linkSection}`);

  if (isEmptyPlan(plan)) return console.log("Already in sync — nothing to do.");
  if (dryRun) return console.log("Dry run — nothing was written.");

  const result = await applySync(prisma, plan);
  console.log(`Done: ${JSON.stringify(result)}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
