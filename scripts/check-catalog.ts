/** CI gate: fails if any rule is missing citation, URL, verification metadata or version history. */
import { ALL_RULES, CATALOG_VERSION, validateCatalog } from "../src/lib/rules/catalog";

const problems = validateCatalog();
const unverified = ALL_RULES.filter((r) => r.verificationStatus === "REQUIRES_VERIFICATION");
console.log(`Catalog ${CATALOG_VERSION}: ${ALL_RULES.length} rules, ${unverified.length} flagged "Requires Regulatory Verification":`);
for (const r of unverified) console.log(`  - ${r.id}: ${r.verificationNote}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("\nCatalog OK.");
