import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChecklist, ValidationError } from "../src/lib/workflows/checklist";
import { WORKFLOWS, type Answers } from "../src/lib/workflows/definitions";
import { SCENARIOS } from "../src/lib/workflows/scenarios";
import { rulesFor, validateCatalog } from "../src/lib/rules/catalog";
import { searchScenarios } from "../src/lib/search/scenario-search";
import type { Classification, WorkflowKey } from "../src/lib/rules/types";

/**
 * Batch 1 (catalog 2026.10.1): roadside inspection / out-of-service, hours of service,
 * medical certificate, CDL status, driver separation. These tests pin the conditional
 * decision logic — which requirements appear for which answers.
 */

const org = { baseState: "TX", preEmploymentAlcoholTesting: false };
const run = (key: WorkflowKey, a: Answers) => generateChecklist(WORKFLOWS[key], a, org);
const cls = (c: ReturnType<typeof run>, id: string): Classification | undefined => c.items.find((i) => i.ruleId === id)?.classification;
const item = (c: ReturnType<typeof run>, id: string) => c.items.find((i) => i.ruleId === id)!;
const APPLIES: Classification[] = ["LEGALLY_REQUIRED", "CONDITIONALLY_REQUIRED"];

const INSPECTED = "2026-10-01T15:00:00.000Z";

// ───────────────────────── Roadside inspection ─────────────────────────

const roadside = (a: Partial<Answers> = {}) =>
  run("ROADSIDE_INSPECTION", {
    inspectionAt: INSPECTED,
    inspectionState: "OH",
    operationType: "INTERSTATE",
    vehicleOos: false,
    driverOos: false,
    violationsFound: "YES",
    stateRequestedReturn: "NO",
    ...a,
  });

test("roadside: clean inspection → deliver and retain the report only", () => {
  const c = roadside({ violationsFound: "NO", stateRequestedReturn: undefined });
  assert.equal(cls(c, "FED-396.9D1-DELIVER-REPORT"), "LEGALLY_REQUIRED");
  assert.equal(cls(c, "FED-396.9D3II-RETAIN-12-MONTHS"), "LEGALLY_REQUIRED");
  for (const id of ["FED-396.9D2-CORRECT-VIOLATIONS", "FED-396.9D3I-CERTIFY-CORRECTIONS", "FED-396.9D3II-RETURN-IF-REQUESTED", "FED-396.9C-VEHICLE-OOS", "FED-383.37D-DRIVER-OOS", "BP-DATAQS-REVIEW"])
    assert.equal(cls(c, id), "NOT_APPLICABLE", id);
});

test("roadside: violations without OOS → correct, certify within 15 days; return only if the State asked", () => {
  const c = roadside();
  assert.equal(cls(c, "FED-396.9D2-CORRECT-VIOLATIONS"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-396.9D3I-CERTIFY-CORRECTIONS"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-396.9D3II-RETURN-IF-REQUESTED"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-396.9C-VEHICLE-OOS"), "NOT_APPLICABLE");

  assert.equal(cls(roadside({ stateRequestedReturn: "YES" }), "FED-396.9D3II-RETURN-IF-REQUESTED"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(roadside({ stateRequestedReturn: "UNKNOWN" }), "FED-396.9D3II-RETURN-IF-REQUESTED"), "UNABLE_TO_DETERMINE");
});

test("roadside: 15-day certification and 24-hour delivery are computed from the inspection time", () => {
  const c = roadside();
  assert.equal(item(c, "FED-396.9D3I-CERTIFY-CORRECTIONS").dueAt?.toISOString(), "2026-10-16T15:00:00.000Z");
  assert.equal(item(c, "FED-396.9D1-DELIVER-REPORT").dueAt?.toISOString(), "2026-10-02T15:00:00.000Z");
});

test("roadside: vehicle OOS → vehicle rule applies with a vehicle-specific prohibition; driver rules do not", () => {
  const c = roadside({ vehicleOos: true, violationsFound: undefined });
  assert.equal(cls(c, "FED-396.9C-VEHICLE-OOS"), "CONDITIONALLY_REQUIRED");
  assert.match(item(c, "FED-396.9C-VEHICLE-OOS").ruleSnapshot.prohibits ?? "", /Operating or towing this vehicle/);
  assert.equal(item(c, "FED-396.9C-VEHICLE-OOS").blocksSafetySensitive, false);
  assert.equal(cls(c, "FED-396.9D2-CORRECT-VIOLATIONS"), "CONDITIONALLY_REQUIRED", "an OOS condition is itself a noted violation");
  for (const id of ["FED-383.37D-DRIVER-OOS", "FED-395.13-DRIVER-OOS-HOS", "FED-392.5-DRIVER-OOS-ALCOHOL", "FED-395.13C2-CERTIFY-ACTION-TAKEN"]) assert.equal(cls(c, id), "NOT_APPLICABLE", id);
});

test("roadside: driver OOS branches by reason", () => {
  const hos = roadside({ driverOos: true, driverOosReason: "HOS", violationsFound: undefined });
  assert.equal(cls(hos, "FED-383.37D-DRIVER-OOS"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(hos, "FED-395.13-DRIVER-OOS-HOS"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(hos, "FED-395.13D3-DELIVER-OOS-FORM"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(hos, "FED-395.13C2-CERTIFY-ACTION-TAKEN"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(hos, "FED-392.5-DRIVER-OOS-ALCOHOL"), "NOT_APPLICABLE");
  assert.equal(cls(hos, "FED-383.37-DRIVER-OOS-LICENSE"), "NOT_APPLICABLE");
  assert.equal(cls(hos, "FED-396.9C-VEHICLE-OOS"), "NOT_APPLICABLE");

  const alcohol = roadside({ driverOos: true, driverOosReason: "ALCOHOL", violationsFound: undefined });
  assert.equal(cls(alcohol, "FED-392.5-DRIVER-OOS-ALCOHOL"), "CONDITIONALLY_REQUIRED");
  assert.equal(item(alcohol, "FED-392.5-DRIVER-OOS-ALCOHOL").dueAt?.toISOString(), "2026-10-02T15:00:00.000Z", "24 hours from issuance");
  assert.equal(cls(alcohol, "FED-395.13-DRIVER-OOS-HOS"), "NOT_APPLICABLE");
  assert.equal(cls(alcohol, "FED-395.13C2-CERTIFY-ACTION-TAKEN"), "NOT_APPLICABLE");

  const lic = roadside({ driverOos: true, driverOosReason: "LICENSE_MEDICAL", violationsFound: undefined });
  assert.equal(cls(lic, "FED-383.37-DRIVER-OOS-LICENSE"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(lic, "FED-395.13-DRIVER-OOS-HOS"), "NOT_APPLICABLE");
});

test("roadside: unknown OOS reason is never guessed", () => {
  const c = roadside({ driverOos: true, driverOosReason: "UNKNOWN", violationsFound: undefined });
  assert.equal(cls(c, "FED-383.37D-DRIVER-OOS"), "CONDITIONALLY_REQUIRED", "the general no-driving rule still applies");
  for (const id of ["FED-395.13-DRIVER-OOS-HOS", "FED-392.5-DRIVER-OOS-ALCOHOL", "FED-383.37-DRIVER-OOS-LICENSE"]) assert.equal(cls(c, id), "UNABLE_TO_DETERMINE", id);
});

test("roadside: intrastate-only → Part 392/395/396 steps are not assumed; Part 383 steps still apply", () => {
  const c = roadside({ operationType: "INTRASTATE", operatingState: "OH", driverOos: true, driverOosReason: "HOS", vehicleOos: true, violationsFound: undefined });
  for (const id of ["FED-396.9C-VEHICLE-OOS", "FED-395.13-DRIVER-OOS-HOS", "FED-396.9D1-DELIVER-REPORT", "FED-396.9D3I-CERTIFY-CORRECTIONS", "FED-396.9D3II-RETAIN-12-MONTHS"])
    assert.equal(cls(c, id), "UNABLE_TO_DETERMINE", id);
  assert.equal(cls(c, "FED-383.37D-DRIVER-OOS"), "CONDITIONALLY_REQUIRED");
  assert.ok(c.warnings.some((w) => /Intrastate-only/.test(w)));
});

test("roadside: state follow-up is flagged, not invented; future inspection time is rejected", () => {
  const c = roadside();
  assert.equal(cls(c, "STATE-ROADSIDE-FOLLOW-UP"), "UNABLE_TO_DETERMINE");
  assert.throws(() => roadside({ inspectionAt: new Date(Date.now() + 86_400_000).toISOString() }), ValidationError);
  assert.throws(() => roadside({ driverOos: true, violationsFound: undefined }), ValidationError, "reason is required once the driver is OOS");
});

// ───────────────────────── Hours of service ─────────────────────────

const hos = (a: Partial<Answers> = {}) =>
  run("HOS_VIOLATION", { situation: "EXCEEDED", vehicleType: "PROPERTY", operationType: "INTERSTATE", cause: "DISPATCH", foundBy: "INTERNAL", ...a });

test("HOS: limits, accurate records and retention always apply to an interstate property carrier", () => {
  const c = hos();
  assert.equal(cls(c, "FED-395.3-NO-DRIVING-PAST-LIMITS"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-395.8E-ACCURATE-RECORDS"), "LEGALLY_REQUIRED");
  assert.equal(cls(c, "FED-395.8K-RETAIN-RODS"), "LEGALLY_REQUIRED");
  assert.equal(cls(c, "BP-HOS-CORRECTIVE-ACTION"), "BEST_PRACTICE");
  for (const id of ["FED-395.1B1-ADVERSE-APPLIES", "FED-395.1B1-ADVERSE-NOT-AVAILABLE", "FED-395.1B2-EMERGENCY", "REVIEW-395.5-PASSENGER-LIMITS", "BP-HOS-ROADSIDE-POINTER"])
    assert.equal(cls(c, id), "NOT_APPLICABLE", id);
});

test("HOS: adverse driving conditions exception turns on whether the conditions were known beforehand", () => {
  const unforeseen = hos({ cause: "ADVERSE", knownBeforehand: "NO" });
  assert.ok(APPLIES.includes(cls(unforeseen, "FED-395.1B1-ADVERSE-APPLIES")!));
  assert.equal(cls(unforeseen, "FED-395.1B1-ADVERSE-NOT-AVAILABLE"), "NOT_APPLICABLE");

  const known = hos({ cause: "ADVERSE", knownBeforehand: "YES" });
  assert.equal(cls(known, "FED-395.1B1-ADVERSE-APPLIES"), "NOT_APPLICABLE");
  assert.ok(APPLIES.includes(cls(known, "FED-395.1B1-ADVERSE-NOT-AVAILABLE")!));

  const unsure = hos({ cause: "ADVERSE", knownBeforehand: "UNKNOWN" });
  assert.equal(cls(unsure, "FED-395.1B1-ADVERSE-APPLIES"), "UNABLE_TO_DETERMINE");
  assert.equal(cls(unsure, "FED-395.1B1-ADVERSE-NOT-AVAILABLE"), "UNABLE_TO_DETERMINE");

  assert.throws(() => hos({ cause: "ADVERSE" }), ValidationError, "must answer the follow-up");
});

test("HOS: emergency, roadside and passenger branches", () => {
  assert.ok(APPLIES.includes(cls(hos({ cause: "EMERGENCY" }), "FED-395.1B2-EMERGENCY")!));
  assert.equal(cls(hos({ foundBy: "ROADSIDE" }), "BP-HOS-ROADSIDE-POINTER"), "BEST_PRACTICE");

  const bus = hos({ vehicleType: "PASSENGER" });
  assert.equal(cls(bus, "FED-395.3-NO-DRIVING-PAST-LIMITS"), "NOT_APPLICABLE", "property-carrying limits are not applied to passenger carriers");
  assert.ok(APPLIES.includes(cls(bus, "REVIEW-395.5-PASSENGER-LIMITS")!));
  assert.equal(item(bus, "REVIEW-395.5-PASSENGER-LIMITS").ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION");
});

test("HOS: intrastate-only operation is not assumed to follow federal Part 395", () => {
  const c = hos({ operationType: "INTRASTATE", operatingState: "TX" });
  assert.equal(cls(c, "FED-395.3-NO-DRIVING-PAST-LIMITS"), "UNABLE_TO_DETERMINE");
  assert.equal(cls(c, "FED-395.8K-RETAIN-RODS"), "UNABLE_TO_DETERMINE");
});

// ───────────────────────── Medical certificate ─────────────────────────

const med = (a: Partial<Answers> = {}) =>
  run("MEDICAL_CERT_EXPIRED", { licenseType: "CDL", certStatus: "EXPIRED", operationType: "INTERSTATE", hasVariance: false, ...a });

test("medical: expired CDL-holder certificate → no driving, CDLIS verification, downgrade clock", () => {
  const c = med();
  assert.equal(cls(c, "FED-391.41A-NO-DRIVING-UNCERTIFIED"), "CONDITIONALLY_REQUIRED");
  assert.ok(item(c, "FED-391.41A-NO-DRIVING-UNCERTIFIED").ruleSnapshot.prohibits);
  assert.equal(cls(c, "FED-391.45-MEDICAL-EXAM"), "LEGALLY_REQUIRED");
  assert.equal(cls(c, "FED-391.23M2-VERIFY-CDLIS"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-383.73O-CDL-DOWNGRADE-CLOCK"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-391.23M1-VERIFY-NON-CDL"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-391.41A-MEDICAL-VARIANCE"), "NOT_APPLICABLE");
});

test("medical: not yet expired → no driving prohibition and no downgrade clock", () => {
  const c = med({ certStatus: "EXPIRING" });
  assert.equal(cls(c, "FED-391.41A-NO-DRIVING-UNCERTIFIED"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-383.73O-CDL-DOWNGRADE-CLOCK"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-391.45-MEDICAL-EXAM"), "LEGALLY_REQUIRED");
});

test("medical: non-CDL driver uses the paper certificate + National Registry check; variance adds its step", () => {
  const c = med({ licenseType: "NON_CDL", hasVariance: true });
  assert.equal(cls(c, "FED-391.23M1-VERIFY-NON-CDL"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-391.23M2-VERIFY-CDLIS"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-383.73O-CDL-DOWNGRADE-CLOCK"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-391.41A-MEDICAL-VARIANCE"), "CONDITIONALLY_REQUIRED");
});

test("medical: intrastate → Part 391 steps undetermined, Part 383 downgrade rule still applies", () => {
  const c = med({ operationType: "INTRASTATE", operatingState: "CA" });
  assert.equal(cls(c, "FED-391.41A-NO-DRIVING-UNCERTIFIED"), "UNABLE_TO_DETERMINE");
  assert.equal(cls(c, "FED-391.23M2-VERIFY-CDLIS"), "UNABLE_TO_DETERMINE");
  assert.equal(cls(c, "FED-383.73O-CDL-DOWNGRADE-CLOCK"), "CONDITIONALLY_REQUIRED");
});

// ───────────────────────── CDL status ─────────────────────────

const cdl = (a: Partial<Answers> = {}) =>
  run("CDL_DISQUALIFIED", { licenseEvent: "SUSPENDED_REVOKED", licenseState: "TX", operationType: "INTERSTATE", noticeReceivedAt: "2026-10-01", convictionInvolved: "NO", alcoholDrugRelated: "NO", ...a });

test("CDL: suspension → no driving, driver notice by end of next business day, verify before return", () => {
  const c = cdl();
  assert.equal(cls(c, "FED-383.37-NO-DRIVING-WITHOUT-VALID-CDL"), "LEGALLY_REQUIRED");
  assert.equal(cls(c, "FED-391.15-DISQUALIFIED-UNTIL-RESTORED"), "LEGALLY_REQUIRED");
  assert.equal(cls(c, "FED-383.33-DRIVER-NOTIFIES-EMPLOYER"), "CONDITIONALLY_REQUIRED");
  // Notice received Thursday 2026-10-01 → end of Friday 2026-10-02.
  assert.equal(item(c, "FED-383.33-DRIVER-NOTIFIES-EMPLOYER").dueAt?.toISOString().slice(0, 10), "2026-10-02");
  assert.equal(cls(c, "FED-383.37-BEFORE-RETURN-TO-DRIVING"), "LEGALLY_REQUIRED");
  assert.equal(cls(c, "FED-383.31-CONVICTION-NOTICE"), "NOT_APPLICABLE");
  assert.equal(cls(c, "REVIEW-CDL-ALCOHOL-DRUG"), "NOT_APPLICABLE");
  assert.equal(cls(c, "STATE-CDL-REINSTATEMENT"), "UNABLE_TO_DETERMINE");
});

test("CDL: notice on a Friday rolls to Monday; unknown notice date gives no computed deadline", () => {
  assert.equal(item(cdl({ noticeReceivedAt: "2026-10-02" }), "FED-383.33-DRIVER-NOTIFIES-EMPLOYER").dueAt?.toISOString().slice(0, 10), "2026-10-05");
  assert.equal(item(cdl({ noticeReceivedAt: undefined }), "FED-383.33-DRIVER-NOTIFIES-EMPLOYER").dueAt, null);
});

test("CDL: conviction and alcohol branches", () => {
  assert.equal(cls(cdl({ convictionInvolved: "YES" }), "FED-383.31-CONVICTION-NOTICE"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(cdl({ convictionInvolved: "UNKNOWN" }), "FED-383.31-CONVICTION-NOTICE"), "UNABLE_TO_DETERMINE");
  const dui = cdl({ alcoholDrugRelated: "YES" });
  assert.equal(cls(dui, "REVIEW-CDL-ALCOHOL-DRUG"), "CONDITIONALLY_REQUIRED");
  assert.equal(item(dui, "REVIEW-CDL-ALCOHOL-DRUG").ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION");
});

test("CDL: expired licence → no suspension-notice or conviction steps; downgrade points to its cause", () => {
  const expired = run("CDL_DISQUALIFIED", { licenseEvent: "EXPIRED", licenseState: "TX", operationType: "INTERSTATE" });
  assert.equal(cls(expired, "FED-383.37-NO-DRIVING-WITHOUT-VALID-CDL"), "LEGALLY_REQUIRED");
  assert.equal(cls(expired, "FED-383.33-DRIVER-NOTIFIES-EMPLOYER"), "NOT_APPLICABLE");
  assert.equal(cls(expired, "FED-383.31-CONVICTION-NOTICE"), "NOT_APPLICABLE");
  assert.equal(cls(expired, "BP-CDL-DOWNGRADE-POINTER"), "NOT_APPLICABLE");

  const down = run("CDL_DISQUALIFIED", { licenseEvent: "DOWNGRADED", licenseState: "TX", operationType: "INTERSTATE" });
  assert.equal(cls(down, "BP-CDL-DOWNGRADE-POINTER"), "BEST_PRACTICE");
});

// ───────────────────────── Driver separation ─────────────────────────

const sep = (a: Partial<Answers> = {}) => run("DRIVER_SEPARATION", { companyState: "TX", operationType: "INTERSTATE", cdlDriver: true, openViolation: "NO", ...a });

test("separation: retention rules always apply; Clearinghouse steps only with an open matter", () => {
  const c = sep();
  for (const id of ["FED-391.51C-KEEP-DQ-FILE", "FED-391.53C-KEEP-INVESTIGATION-FILE", "FED-395.8K-KEEP-LOGS", "FED-391.23G-ANSWER-HISTORY-REQUESTS"]) assert.equal(cls(c, id), "LEGALLY_REQUIRED", id);
  assert.equal(cls(c, "FED-382.401-KEEP-DA-RECORDS"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-382.705-REPORT-BEFORE-CLOSING"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-391.23E4-FOLLOW-UP-PLAN"), "NOT_APPLICABLE");
  assert.equal(cls(c, "STATE-SEP-EMPLOYMENT-LAW"), "UNABLE_TO_DETERMINE");

  const open = sep({ openViolation: "YES" });
  assert.equal(cls(open, "FED-382.705-REPORT-BEFORE-CLOSING"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(open, "FED-391.23E4-FOLLOW-UP-PLAN"), "CONDITIONALLY_REQUIRED");

  assert.equal(cls(sep({ openViolation: "UNKNOWN" }), "FED-382.705-REPORT-BEFORE-CLOSING"), "UNABLE_TO_DETERMINE");
});

test("separation: non-CDL driver → no Part 382 steps and no drug/alcohol question", () => {
  const c = run("DRIVER_SEPARATION", { companyState: "TX", operationType: "INTERSTATE", cdlDriver: false });
  assert.equal(cls(c, "FED-382.401-KEEP-DA-RECORDS"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-382.705-REPORT-BEFORE-CLOSING"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-391.51C-KEEP-DQ-FILE"), "LEGALLY_REQUIRED");
});

// ───────────────────────── Catalog + scenario wiring ─────────────────────────

test("catalog: batch-1 rules are valid, cite official sources, and record a verification date or a reason", () => {
  assert.deepEqual(validateCatalog(), []);
  for (const key of ["ROADSIDE_INSPECTION", "HOS_VIOLATION", "MEDICAL_CERT_EXPIRED", "CDL_DISQUALIFIED", "DRIVER_SEPARATION"] as WorkflowKey[]) {
    const rules = rulesFor(key);
    assert.ok(rules.length >= 8, `${key} has ${rules.length} rules`);
    for (const r of rules) {
      if (r.verificationStatus === "VERIFIED") assert.equal(r.lastVerified, "2026-10-09", r.id);
      else assert.ok(r.verificationNote, `${r.id} explains why it needs verification`);
      if (r.kind === "LEGAL" && r.jurisdiction === "FEDERAL") for (const s of r.sources) assert.match(s.url, /^https:\/\/www\.ecfr\.gov\/current\/title-49\/section-\d+\.\d+$/, r.id);
      // A vehicle- or licence-specific prohibition must not also be labelled as a safety-sensitive blocker.
      if (r.prohibits) assert.equal(r.blocksSafetySensitive, false, r.id);
    }
  }
});

test("the 10 priority scenarios are live, and every live preset produces a checklist once the remaining questions are answered", () => {
  const priority = [1, 26, 27, 51, 19, 11, 52, 28, 53, 50];
  for (const n of priority) {
    const s = SCENARIOS.find((x) => x.n === n)!;
    assert.equal(s.status, "LIVE", `scenario ${n} ${s.title}`);
    assert.ok(WORKFLOWS[s.workflow!], `scenario ${n} workflow`);
  }
  // Presets must be valid option values for their questions.
  for (const s of SCENARIOS.filter((x) => x.status === "LIVE")) {
    const def = WORKFLOWS[s.workflow!];
    for (const [k, v] of Object.entries(s.preset ?? {})) {
      const q = def.questions.find((x) => x.id === k)!;
      if (q.options) assert.ok(q.options.some((o) => o.value === v), `scenario ${s.n}: ${k}=${String(v)} is not an option`);
      if (q.type === "boolean") assert.equal(typeof v, "boolean", `scenario ${s.n}: ${k}`);
    }
  }
});

test("search: the brief's example phrases reach the right live workflow", () => {
  const top = (q: string) => searchScenarios(q)[0]?.scenario;
  assert.equal(top("My driver failed a drug test.")?.workflow, "DRUG_ALCOHOL_VIOLATION");
  assert.equal(top("My truck got put out of service.")?.n, 51);
  assert.equal(top("I need to hire another driver.")?.workflow, "HIRE_CDL_DRIVER");
  assert.equal(top("My driver's medical card expired.")?.n, 11);
  assert.equal(top("My driver ran out of hours.")?.workflow, "HOS_VIOLATION");
  assert.equal(top("DOT pulled my truck over and found bad brakes.")?.workflow, "ROADSIDE_INSPECTION");
  assert.equal(top("my driver was placed out of service")?.n, 27);
  assert.equal(top("driver's CDL got suspended")?.n, 53);
  assert.equal(top("a driver quit yesterday")?.n, 50);
  assert.equal(top("driver went over his 11 hours")?.workflow, "HOS_VIOLATION");
  for (const q of ["My truck got put out of service.", "My driver's medical card expired.", "My driver ran out of hours.", "driver's CDL got suspended", "a driver quit yesterday"])
    assert.equal(top(q)?.status, "LIVE", q);
});
