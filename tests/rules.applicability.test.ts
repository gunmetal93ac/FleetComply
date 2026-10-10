import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, evaluateRule, addBusinessDaysEndOfDay } from "../src/lib/rules/engine";
import { ALL_RULES, getRule, validateCatalog } from "../src/lib/rules/catalog";
import { createStateRegistry } from "../src/lib/rules/state-registry";
import type { Facts } from "../src/lib/rules/types";

const rule = (id: string) => {
  const r = getRule(id);
  assert.ok(r, `rule ${id} exists`);
  return r!;
};

test("catalog passes integrity checks (citations, URLs, verification metadata, change log)", () => {
  assert.deepEqual(validateCatalog(), []);
  assert.ok(ALL_RULES.length >= 30);
});

test("every VERIFIED federal Title 49 rule links to eCFR", () => {
  for (const r of ALL_RULES.filter((r) => r.verificationStatus === "VERIFIED" && r.kind === "LEGAL" && r.jurisdiction === "FEDERAL")) {
    assert.ok(r.sources.some((s) => s.url.startsWith("https://www.ecfr.gov/")), r.id);
  }
});

test("three-valued logic: unknown facts never silently evaluate to false", () => {
  assert.equal(evaluateCondition({ fact: "x", eq: "YES" }, {}).value, "unknown");
  assert.equal(evaluateCondition({ fact: "x", eq: "YES" }, { x: "UNKNOWN" }).value, "unknown");
  // all: a false child decides even if another is unknown
  assert.equal(evaluateCondition({ all: [{ fact: "a", isTrue: true }, { fact: "b", isTrue: true }] }, { a: false }).value, false);
  // any: a true child decides even if another is unknown
  assert.equal(evaluateCondition({ any: [{ fact: "a", isTrue: true }, { fact: "b", isTrue: true }] }, { a: true }).value, true);
  assert.equal(evaluateCondition({ any: [{ fact: "a", isTrue: true }, { fact: "b", isTrue: true }] }, { a: false }).value, "unknown");
  assert.equal(evaluateCondition({ not: { fact: "a", eq: "YES" } }, { a: "NO" }).value, true);
});

const interstate: Facts = { operationType: "INTERSTATE", operatingState: "TX", companyState: "TX" };

test("unconditional federal rule is LEGALLY_REQUIRED for interstate", () => {
  const e = evaluateRule(rule("FED-391.21-EMPLOYMENT-APPLICATION"), interstate);
  assert.equal(e.classification, "LEGALLY_REQUIRED");
});

test("interstate-only rule is UNABLE_TO_DETERMINE for intrastate when the state pack is not loaded", () => {
  const e = evaluateRule(rule("FED-391.21-EMPLOYMENT-APPLICATION"), { ...interstate, operationType: "INTRASTATE" });
  assert.equal(e.classification, "UNABLE_TO_DETERMINE");
  assert.match(e.reasons.join(" "), /state's adopted rules govern/);
});

test("interstate-only rule applies to intrastate once a loaded state pack adopts it", () => {
  const states = createStateRegistry([
    {
      code: "TX", name: "Texas", status: "LOADED", topics: [],
      adoptions: { "FED-391.21-EMPLOYMENT-APPLICATION": { citation: "TEST-CITATION", url: "https://example.test", lastVerified: "2026-01-01" } },
    },
  ]);
  const e = evaluateRule(rule("FED-391.21-EMPLOYMENT-APPLICATION"), { ...interstate, operationType: "INTRASTATE" }, { states });
  assert.equal(e.classification, "LEGALLY_REQUIRED");
  assert.match(e.reasons.join(" "), /TEST-CITATION/);
});

test("Part 382 requirements apply to intrastate CDL drivers (ALL_COMMERCE)", () => {
  const e = evaluateRule(rule("FED-382.301-PRE-EMPLOYMENT-DRUG-TEST"), { ...interstate, operationType: "INTRASTATE", preEmploymentTestException: "NO" });
  assert.equal(e.classification, "CONDITIONALLY_REQUIRED");
});

test("pre-employment drug test vs. documented exception are mutually exclusive", () => {
  const facts = { ...interstate, preEmploymentTestException: "YES" };
  assert.equal(evaluateRule(rule("FED-382.301-PRE-EMPLOYMENT-DRUG-TEST"), facts).classification, "NOT_APPLICABLE");
  assert.equal(evaluateRule(rule("FED-382.301B-EXCEPTION-RECORDS"), facts).classification, "CONDITIONALLY_REQUIRED");
});

test("pre-employment alcohol test is COMPANY_POLICY only when the org adopted it", () => {
  const r = rule("POLICY-382.301D-PRE-EMPLOYMENT-ALCOHOL");
  assert.equal(evaluateRule(r, { ...interstate, companyAlcoholPreEmploymentPolicy: true }).classification, "COMPANY_POLICY");
  assert.equal(evaluateRule(r, { ...interstate, companyAlcoholPreEmploymentPolicy: false }).classification, "NOT_APPLICABLE");
});

test("ELDT check is a best practice, never presented as a legal requirement", () => {
  const e = evaluateRule(rule("BP-380-ELDT-CHECK"), { ...interstate, experience: "NEW_LICENSE" });
  assert.equal(e.classification, "BEST_PRACTICE");
});

test("road test: CDL equivalent vs. tank/doubles road test", () => {
  assert.equal(evaluateRule(rule("FED-391.33-ROAD-TEST-EQUIVALENT"), { ...interstate, tankOrDoublesAssignment: "YES" }).classification, "NOT_APPLICABLE");
  assert.equal(evaluateRule(rule("FED-391.31-ROAD-TEST-TANK-DOUBLES"), { ...interstate, tankOrDoublesAssignment: "YES" }).classification, "CONDITIONALLY_REQUIRED");
});

test("safety performance history: unknown prior employment → UNABLE_TO_DETERMINE", () => {
  const e = evaluateRule(rule("FED-391.23-SAFETY-PERFORMANCE-HISTORY"), { ...interstate, priorDotEmployment: "UNKNOWN" });
  assert.equal(e.classification, "UNABLE_TO_DETERMINE");
});

test("state-dependent HR items stay UNABLE_TO_DETERMINE and carry a Requires Regulatory Verification reason", () => {
  const e = evaluateRule(rule("EMP-STATE-WITHHOLDING-NEW-HIRE"), interstate);
  assert.equal(e.classification, "UNABLE_TO_DETERMINE");
  assert.ok(e.reasons.some((r) => r.startsWith("Requires Regulatory Verification")));
});

test("I-9 is categorized as general employment, not the DQ file", () => {
  assert.equal(rule("EMP-I9").recordCategory, "GENERAL_EMPLOYMENT");
  assert.equal(rule("EMP-W4").recordCategory, "GENERAL_EMPLOYMENT");
});

test("deadlines differ by item and are computed from the anchor", () => {
  const facts = { ...interstate, employmentStartDate: "2026-11-02" };
  const mvr = evaluateRule(rule("FED-391.23-MVR-PRE-HIRE"), facts);
  const hazmat = evaluateRule(rule("FED-172.704-HAZMAT-TRAINING"), { ...facts, hazmat: true });
  assert.equal(mvr.dueAt?.toISOString().slice(0, 10), "2026-12-02");
  assert.equal(hazmat.dueAt?.toISOString().slice(0, 10), "2027-01-31");
});

test("business-day deadlines skip weekends", () => {
  // Thursday → close of 3rd business day = Tuesday
  const d = addBusinessDaysEndOfDay(new Date("2026-10-08T15:00:00Z"), 3);
  assert.equal(d.toISOString(), "2026-10-13T23:59:59.999Z");
});

test("retention periods differ by record type", () => {
  const drug = rule("FED-382.301-PRE-EMPLOYMENT-DRUG-TEST");
  const periods = new Set(drug.retention.map((r) => r.period));
  assert.ok(periods.size >= 3);
});
