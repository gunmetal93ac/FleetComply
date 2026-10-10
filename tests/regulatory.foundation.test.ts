import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSections, isEcfrSectionUrl, parseCitation } from "../src/lib/regulatory/citations";
import { buildDependencyMap, impactOfProvision, monitoredScenarios, provisionsForScenario } from "../src/lib/regulatory/dependencies";
import { isEmptyPlan, planSync, REGULATORY_SOURCES, type ExistingState } from "../src/lib/regulatory/sync";
import { assertPlatformAdmin, can, isPlatformAdmin, PlatformAdminRequiredError, type Role } from "../src/lib/auth/rbac";
import { navFor } from "../src/lib/nav";
import { ALL_RULES } from "../src/lib/rules/catalog";
import { SCENARIOS, VISIBLE_SCENARIOS } from "../src/lib/workflows/scenarios";
import { generateChecklist } from "../src/lib/workflows/checklist";
import { WORKFLOWS } from "../src/lib/workflows/definitions";
import type { RegulatoryRule } from "../src/lib/rules/types";

/**
 * Regulatory Intelligence — Stage 1 (foundation): citation parsing, the dependency map,
 * sync planning and the platform-administrator gate. No network, no AI, no publishing.
 */

const ecfr = (section: string, citation: string) => ({ citation, url: `https://www.ecfr.gov/current/title-49/section-${section}` });

// ───────────────────────── Citation parsing ─────────────────────────

test("citations: section comes from the official link; paragraphs from the text", () => {
  const p = parseCitation(ecfr("396.9", "49 CFR 396.9(d)(3)(ii)"))!;
  assert.deepEqual([p.title, p.part, p.section, p.paragraphs], [49, "396", "396.9", ["(d)(3)(ii)"]]);
  assert.deepEqual(parseCitation(ecfr("382.705", "49 CFR 382.705(b)(1)(iii), (b)(1)(iv), (b)(3)"))!.paragraphs, ["(b)(1)(iii)", "(b)(1)(iv)", "(b)(3)"]);
  assert.deepEqual(parseCitation(ecfr("391.25", "49 CFR 391.25"))!.paragraphs, [], "no paragraph named = whole section");
});

test("citations: ranges, tables and explanatory text", () => {
  assert.deepEqual(parseCitation(ecfr("396.17", "49 CFR 396.17(a), (b), (d)–(g)"))!.paragraphs, ["(a)", "(b)", "(d)..(g)"]);
  assert.deepEqual(parseCitation(ecfr("391.51", "49 CFR 391.51(b)(6)–(8), (c), (d)"))!.paragraphs, ["(b)(6)..(8)", "(c)", "(d)"]);
  assert.deepEqual(parseCitation(ecfr("383.51", "49 CFR 383.51(e), Table 4"))!.paragraphs, ["(e)"]);
  // Words in parentheses are not paragraph designators.
  assert.deepEqual(parseCitation(ecfr("382.107", "49 CFR 382.107 (definition of “actual knowledge”)"))!.paragraphs, []);
  assert.deepEqual(parseCitation(ecfr("396.11", "49 CFR 396.11(a) (driver vehicle inspection reports — context)"))!.paragraphs, ["(a)"]);
  // Temporary "T" sections are distinct provisions.
  assert.equal(parseCitation(ecfr("390.5T", "49 CFR 390.5T"))!.section, "390.5T");
});

test("citations: anything that is not an eCFR section link is not monitorable, and disagreements are flagged", () => {
  assert.equal(parseCitation({ citation: "State law (varies)", url: "https://www.fmcsa.dot.gov/" }), null);
  assert.equal(parseCitation({ citation: "49 CFR Part 391", url: "https://www.ecfr.gov/current/title-49/part-391" }), null);
  assert.equal(isEcfrSectionUrl("https://www.ecfr.gov/current/title-49/section-391.23"), true);
  assert.equal(isEcfrSectionUrl("https://evil.example/current/title-49/section-391.23"), false);
  assert.equal(parseCitation(ecfr("391.23", "49 CFR 391.51(c)"))!.mismatch, "391.51");
  assert.equal(parseCitation(ecfr("391.23", "49 CFR 391.23(c)"))!.mismatch, undefined);
});

test("citations: sections sort numerically", () => {
  assert.deepEqual(["390.21", "382.1203", "390.5", "382.107", "40.191"].sort(compareSections), ["40.191", "382.107", "382.1203", "390.5", "390.21"]);
});

// ───────────────────────── Dependency map over the real catalog ─────────────────────────

const map = buildDependencyMap();

test("dependency map: every eCFR-linked step is mapped; nothing is invented", () => {
  assert.ok(map.provisions.length >= 60, `${map.provisions.length} provisions`);
  assert.equal(new Set(map.provisions.map((p) => `${p.title}:${p.section}`)).size, map.provisions.length, "no duplicate provisions");
  assert.equal(new Set(map.refs.map((r) => `${r.ruleId}|${r.section}`)).size, map.refs.length, "one reference per rule + provision");

  const ruleIds = new Set(ALL_RULES.map((r) => r.id));
  const sections = new Set(map.provisions.map((p) => p.section));
  for (const ref of map.refs) {
    assert.ok(ruleIds.has(ref.ruleId), ref.ruleId);
    assert.ok(sections.has(ref.section), ref.section);
    // Every reference must trace back to a citation that really is on that rule.
    const rule = ALL_RULES.find((r) => r.id === ref.ruleId)!;
    assert.ok(rule.sources.some((s) => s.url.endsWith(`/section-${ref.section}`)), `${ref.ruleId} → ${ref.section}`);
  }
  for (const rule of ALL_RULES) {
    const linked = rule.sources.some((s) => isEcfrSectionUrl(s.url));
    assert.equal(map.refs.some((r) => r.ruleId === rule.id), linked, rule.id);
    assert.equal(map.rulesWithoutProvision.includes(rule.id), !linked, rule.id);
  }
});

test("dependency map: catalog citations agree with their links", () => {
  assert.deepEqual(map.mismatches, [], "a citation's text names a different section than its link");
});

test("dependency map: one regulation → many scenarios, one scenario → many regulations", () => {
  const impact = impactOfProvision("391.11", undefined, map);
  assert.ok(impact.rules.length >= 2);
  assert.ok(impact.workflows.length >= 2, "§ 391.11 is cited by more than one workflow");
  assert.ok(impact.scenarios.length >= 5);
  assert.ok(impact.scenarios.every((s) => s.status === "LIVE" && s.aliasOf === undefined), "only published, visible scenarios");

  const hire = SCENARIOS.find((s) => s.n === 1)!;
  const needs = provisionsForScenario(hire, undefined, map);
  for (const s of ["391.23", "391.51", "382.301"]) assert.ok(needs.includes(s), `hiring depends on § ${s}`);
  assert.ok(needs.every((s) => !s.startsWith("396.")), "hiring does not depend on Part 396");

  // A provision that only the roadside workflow cites does not reach hiring scenarios.
  const roadside = impactOfProvision("396.9", undefined, map);
  assert.ok(roadside.scenarios.length > 0 && roadside.scenarios.every((s) => s.workflow !== "HIRE_CDL_DRIVER"));
  assert.deepEqual(impactOfProvision("999.99", undefined, map).rules, [], "unknown provision → no impact");
});

test("dependency map: paragraph references are kept at step level and merged when a step cites a section twice", () => {
  const rules = [
    { ...ALL_RULES[0], id: "T1", sources: [ecfr("383.51", "49 CFR 383.51(b), Table 1"), ecfr("383.51", "49 CFR 383.51(a)(3), (a)(4)")] },
    { ...ALL_RULES[0], id: "T2", sources: [ecfr("383.51", "49 CFR 383.51(c)"), ecfr("383.51", "49 CFR 383.51")] },
  ] as RegulatoryRule[];
  const m = buildDependencyMap(rules);
  assert.equal(m.provisions.length, 1);
  assert.deepEqual(m.refs.find((r) => r.ruleId === "T1")!.paragraphs, ["(b)", "(a)(3)", "(a)(4)"]);
  assert.deepEqual(m.refs.find((r) => r.ruleId === "T2")!.paragraphs, [], "a whole-section citation widens the reference to the whole section");
});

test("dependency map: every published scenario with a workflow is covered", () => {
  const covered = monitoredScenarios(undefined, map);
  const live = VISIBLE_SCENARIOS.filter((s) => s.status === "LIVE");
  assert.equal(covered.length, live.length);
});

// ───────────────────────── Sync planning ─────────────────────────

const EMPTY: ExistingState = { sourceKeys: [], provisions: [], refs: [], ruleVersions: [] };

function applied(state: ExistingState): ExistingState {
  const plan = planSync(state);
  let n = 0;
  const provisions = [...state.provisions, ...plan.createProvisions.map((p) => ({ id: `p${n++}`, title: p.title, section: p.section }))];
  const refs = [
    ...state.refs.map((r) => {
      const u = plan.updateRefs.find((x) => x.id === r.id);
      return u ? { ...r, paragraphs: u.ref.paragraphs, citationText: u.ref.citationText, sourceUrl: u.ref.sourceUrl } : r;
    }),
    ...plan.createRefs.map((r) => ({ id: `r${n++}`, ruleId: r.ruleId, provisionKey: `${r.title}:${r.section}`, paragraphs: r.paragraphs, citationText: r.citationText, sourceUrl: r.sourceUrl })),
  ];
  return {
    sourceKeys: [...state.sourceKeys, ...plan.createSources.map((s) => s.key)],
    provisions,
    refs,
    ruleVersions: [...state.ruleVersions, ...plan.createRuleVersions.map((r) => ({ ruleId: r.id, version: r.version }))],
  };
}

test("sync: first run creates everything; a second run does nothing (no duplicates)", () => {
  const first = planSync(EMPTY);
  assert.equal(first.createSources.length, REGULATORY_SOURCES.length);
  assert.equal(first.createProvisions.length, map.provisions.length);
  assert.equal(first.createRefs.length, map.refs.length);
  assert.equal(first.createRuleVersions.length, ALL_RULES.length);

  const after = applied(EMPTY);
  const second = planSync(after);
  assert.ok(isEmptyPlan(second), "second run must be a no-op");
  assert.equal(second.staleRefs.length, 0);
});

test("sync: existing rule versions are never recreated; changed citations refresh; removed ones are only reported", () => {
  // The database as it was before this feature: 52 rule versions, nothing else.
  const legacy = { ...EMPTY, ruleVersions: ALL_RULES.slice(0, 52).map((r) => ({ ruleId: r.id, version: r.version })) };
  assert.equal(planSync(legacy).createRuleVersions.length, ALL_RULES.length - 52);

  const state = applied(EMPTY);
  state.refs[0] = { ...state.refs[0], paragraphs: ["(z)"] };
  state.refs.push({ id: "gone", ruleId: "REMOVED-RULE", provisionKey: "49:391.23", paragraphs: [], citationText: "49 CFR 391.23", sourceUrl: "x" });
  const plan = planSync(state);
  assert.equal(plan.updateRefs.length, 1);
  assert.equal(plan.createRefs.length, 0);
  assert.deepEqual(plan.staleRefs.map((s) => s.ruleId), ["REMOVED-RULE"]);
  assert.ok(!("deleteRefs" in plan), "the sync has no delete operation");
});

// ───────────────────────── Access control ─────────────────────────

test("access: platform administrator is separate from every customer role", () => {
  const roles: Role[] = ["OWNER", "ADMIN", "SAFETY_MANAGER", "HR", "DISPATCH", "VIEWER"];
  for (const role of roles) {
    // A customer role alone — even Owner with every permission — is not a platform administrator.
    assert.equal(isPlatformAdmin({ role, platformAdmin: false } as { platformAdmin: boolean }), false, role);
    assert.throws(() => assertPlatformAdmin({ platformAdmin: false }), PlatformAdminRequiredError, role);
  }
  assert.ok(can("OWNER", "org:manage"), "sanity: Owner still has its company permissions");
  assert.throws(() => assertPlatformAdmin(null), PlatformAdminRequiredError);
  assert.throws(() => assertPlatformAdmin(undefined), PlatformAdminRequiredError);
  assert.throws(() => assertPlatformAdmin({}), PlatformAdminRequiredError);
  assert.throws(() => assertPlatformAdmin({ platformAdmin: true, disabled: true }), PlatformAdminRequiredError, "a disabled account is refused");
  assert.doesNotThrow(() => assertPlatformAdmin({ platformAdmin: true }));
  // Truthy-but-not-true values must not pass.
  assert.equal(isPlatformAdmin({ platformAdmin: "true" as unknown as boolean }), false);
});

test("access: the Regulatory Intelligence link is shown only to platform administrators", () => {
  const has = (items: ReturnType<typeof navFor>) => items.some((n) => n.href === "/admin/regulatory");
  assert.equal(has(navFor(false)), false, "signed out");
  assert.equal(has(navFor(true)), false, "signed-in customer");
  assert.equal(has(navFor(false, true)), false, "flag without a session");
  assert.equal(has(navFor(true, true)), true);
});

// ───────────────────────── Existing behaviour is untouched ─────────────────────────

test("existing workflows still generate checklists", () => {
  const c = generateChecklist(WORKFLOWS.DRUG_ALCOHOL_VIOLATION, { violationType: "POSITIVE_DRUG", determinationAt: "2026-10-01T12:00:00.000Z", willReturnToDuty: "NO" }, { baseState: "TX", preEmploymentAlcoholTesting: false });
  assert.ok(c.items.length > 5);
});
