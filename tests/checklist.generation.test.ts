import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChecklist, ValidationError } from "../src/lib/workflows/checklist";
import { WORKFLOWS, type Answers } from "../src/lib/workflows/definitions";
import { SCENARIOS } from "../src/lib/workflows/scenarios";

const org = { baseState: "TX", preEmploymentAlcoholTesting: false };

const baseHire: Answers = {
  companyState: "TX",
  licenseState: "OK",
  operatingState: "TX",
  operationType: "INTERSTATE",
  cdlVehicle: true,
  cdlClass: "A",
  hazmat: false,
  passengers: false,
  tankOrDoublesAssignment: "NO",
  dotTesting: "YES",
  experience: "EXPERIENCED",
  priorDotEmployment: "YES",
  nonFmcsaDotEmployer: "NO",
  priorViolation: "NO",
  preEmploymentTestException: "NO",
  exemption: "NONE",
  employmentStartDate: "2026-11-02",
};

const hire = (a: Partial<Answers> = {}, o = org) => generateChecklist(WORKFLOWS.HIRE_CDL_DRIVER, { ...baseHire, ...a }, o);
const cls = (c: ReturnType<typeof hire>, id: string) => c.items.find((i) => i.ruleId === id)?.classification;

test("experienced interstate hire: core federal items are required and blocking items are flagged", () => {
  const c = hire();
  for (const id of [
    "FED-391.21-EMPLOYMENT-APPLICATION",
    "FED-391.51-MEDICAL-CERTIFICATION",
    "FED-382.701-PRE-EMPLOYMENT-QUERY",
    "FED-391.23F-DA-HISTORY-CONSENT",
  ])
    assert.equal(cls(c, id), "LEGALLY_REQUIRED", id);
  assert.equal(cls(c, "FED-382.301-PRE-EMPLOYMENT-DRUG-TEST"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-391.23-SAFETY-PERFORMANCE-HISTORY"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-391.23-NO-PRIOR-DOT-EMPLOYMENT"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-172.704-HAZMAT-TRAINING"), "NOT_APPLICABLE");
  const drug = c.items.find((i) => i.ruleId === "FED-382.301-PRE-EMPLOYMENT-DRUG-TEST")!;
  assert.equal(drug.blocksSafetySensitive, true);
  assert.equal(drug.status, "NOT_STARTED");
});

test("not-applicable items start as NOT_APPLICABLE and never block", () => {
  const c = hire();
  for (const i of c.items.filter((i) => i.classification === "NOT_APPLICABLE")) {
    assert.equal(i.status, "NOT_APPLICABLE");
    assert.equal(i.blocksSafetySensitive, false);
  }
});

test("hazmat + newly licensed + prior violation personalize the checklist", () => {
  const c = hire({ hazmat: true, experience: "NEW_LICENSE", priorViolation: "YES", priorDotEmployment: "NO" });
  assert.equal(cls(c, "FED-172.704-HAZMAT-TRAINING"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "BP-380-ELDT-CHECK"), "BEST_PRACTICE");
  assert.equal(cls(c, "FED-382.701D-PRIOR-VIOLATION-RTD"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-391.23-NO-PRIOR-DOT-EMPLOYMENT"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-391.23-SAFETY-PERFORMANCE-HISTORY"), "NOT_APPLICABLE");
});

test("non-FMCSA DOT question is hidden and treated as NO when there was no prior DOT employment", () => {
  const c = hire({ priorDotEmployment: "NO", nonFmcsaDotEmployer: undefined });
  assert.equal(cls(c, "FED-391.23E-NON-FMCSA-DOT-HISTORY"), "NOT_APPLICABLE");
});

test("company pre-employment alcohol policy adds a COMPANY_POLICY item", () => {
  const c = hire({}, { ...org, preEmploymentAlcoholTesting: true });
  assert.equal(cls(c, "POLICY-382.301D-PRE-EMPLOYMENT-ALCOHOL"), "COMPANY_POLICY");
});

test("intrastate hire: Part 391 items are undetermined, Part 382 items still required, with a warning", () => {
  const c = hire({ operationType: "INTRASTATE" });
  assert.equal(cls(c, "FED-391.21-EMPLOYMENT-APPLICATION"), "UNABLE_TO_DETERMINE");
  assert.equal(cls(c, "FED-382.701-PRE-EMPLOYMENT-QUERY"), "LEGALLY_REQUIRED");
  assert.ok(c.warnings.some((w) => /Intrastate-only/.test(w)));
});

test("DOT testing answer that contradicts Part 382 produces a warning, not a silent drop", () => {
  const c = hire({ dotTesting: "NO" });
  assert.equal(cls(c, "FED-382.301-PRE-EMPLOYMENT-DRUG-TEST"), "CONDITIONALLY_REQUIRED");
  assert.ok(c.warnings.some((w) => /Part 382/.test(w)));
});

test("general employment items are separated from DQ-file items", () => {
  const c = hire();
  const i9 = c.items.find((i) => i.ruleId === "EMP-I9")!;
  assert.equal(i9.ruleSnapshot.recordCategory, "GENERAL_EMPLOYMENT");
  assert.match(i9.stage, /not DQ file/);
});

test("validation: missing answers and non-CDL positions are rejected with field errors", () => {
  assert.throws(() => hire({ companyState: "" }), (e: unknown) => e instanceof ValidationError && "companyState" in e.fieldErrors);
  assert.throws(() => hire({ cdlVehicle: false }), (e: unknown) => e instanceof ValidationError && "cdlVehicle" in e.fieldErrors);
  assert.throws(() => hire({ cdlClass: "Z" }), (e: unknown) => e instanceof ValidationError && "cdlClass" in e.fieldErrors);
});

test("checklist items snapshot the rule version they were generated from", () => {
  const c = hire();
  const item = c.items[0];
  assert.equal(item.ruleSnapshot.version, item.ruleVersion);
  item.ruleSnapshot.title = "mutated";
  assert.notEqual(hire().items[0].title, "mutated");
});

// ───── Accident workflow ─────

const baseAccident: Answers = {
  accidentAt: "2026-10-08T14:00:00Z",
  accidentState: "CA",
  onlyBoardingOrCargo: false,
  fatality: false,
  injuryTreatedAway: true,
  towAway: false,
  driverCited: "NO",
  hazmatInvolved: false,
};
const acc = (a: Partial<Answers> = {}) => generateChecklist(WORKFLOWS.DOT_ACCIDENT_RESPONSE, { ...baseAccident, ...a }, org);

test("accident: injury without citation → recordable, but no post-accident testing", () => {
  const c = acc();
  assert.equal(cls(c, "FED-390.15B-ACCIDENT-REGISTER"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-382.303-POST-ACCIDENT-ALCOHOL"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-382.303-POST-ACCIDENT-DRUG"), "NOT_APPLICABLE");
});

test("accident: injury + citation → both tests required with 2h and 32h deadlines", () => {
  const c = acc({ driverCited: "YES" });
  const alc = c.items.find((i) => i.ruleId === "FED-382.303-POST-ACCIDENT-ALCOHOL")!;
  const drug = c.items.find((i) => i.ruleId === "FED-382.303-POST-ACCIDENT-DRUG")!;
  assert.equal(alc.classification, "CONDITIONALLY_REQUIRED");
  assert.equal(alc.dueAt?.toISOString(), "2026-10-08T16:00:00.000Z");
  assert.equal(drug.dueAt?.toISOString(), "2026-10-09T22:00:00.000Z");
});

test("accident: fatality requires testing even without a citation", () => {
  const c = acc({ fatality: true, injuryTreatedAway: false, driverCited: "NO" });
  assert.equal(cls(c, "FED-382.303-POST-ACCIDENT-ALCOHOL"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-382.209-NO-ALCOHOL-AFTER-ACCIDENT"), "CONDITIONALLY_REQUIRED");
});

test("accident: citation pending → testing UNABLE_TO_DETERMINE with a warning", () => {
  const c = acc({ driverCited: "PENDING", towAway: true });
  assert.equal(cls(c, "FED-382.303-POST-ACCIDENT-ALCOHOL"), "UNABLE_TO_DETERMINE");
  assert.ok(c.warnings.some((w) => /8 hours/.test(w)));
});

test("accident: loading-only occurrence is not a DOT accident", () => {
  const c = acc({ onlyBoardingOrCargo: true, driverCited: "YES" });
  assert.equal(cls(c, "FED-390.15B-ACCIDENT-REGISTER"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-382.303-POST-ACCIDENT-ALCOHOL"), "NOT_APPLICABLE");
  assert.equal(cls(c, "BP-ACC-NOT-RECORDABLE"), "BEST_PRACTICE");
});

test("accident: hazmat release triggers NRC (12h) and 5800.1 (30 days)", () => {
  const c = acc({ hazmatInvolved: true, hazmatReleased: true, nrcTrigger: "YES" });
  const nrc = c.items.find((i) => i.ruleId === "FED-171.15-NRC-IMMEDIATE-NOTICE")!;
  assert.equal(nrc.classification, "CONDITIONALLY_REQUIRED");
  assert.equal(nrc.dueAt?.toISOString(), "2026-10-09T02:00:00.000Z");
  assert.equal(cls(c, "FED-171.16-WRITTEN-HAZMAT-REPORT"), "CONDITIONALLY_REQUIRED");
});

test("accident: future accident time is rejected", () => {
  assert.throws(() => acc({ accidentAt: "2999-01-01T00:00:00Z" }), ValidationError);
});

// ───── Drug & alcohol violation workflow ─────

const viol = (a: Answers) =>
  generateChecklist(WORKFLOWS.DRUG_ALCOHOL_VIOLATION, { determinationAt: "2026-10-08T15:00:00Z", ...a }, org);

test("violation: refusal → employer reports within 3 business days; return-to-duty items only if returning", () => {
  const c = viol({ violationType: "REFUSAL", willReturnToDuty: "NO" });
  const rep = c.items.find((i) => i.ruleId === "FED-382.705B-EMPLOYER-CLEARINGHOUSE-REPORT")!;
  assert.equal(rep.classification, "CONDITIONALLY_REQUIRED");
  assert.equal(rep.dueAt?.toISOString(), "2026-10-13T23:59:59.999Z");
  assert.equal(cls(c, "FED-40.191-REFUSAL-DETERMINATION"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-40.305-RTD-TEST"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-40.287-SAP-LIST"), "CONDITIONALLY_REQUIRED");
});

test("violation: positive drug test is reported by the MRO, not the employer", () => {
  const c = viol({ violationType: "POSITIVE_DRUG", willReturnToDuty: "YES" });
  assert.equal(cls(c, "FED-382.705B-EMPLOYER-CLEARINGHOUSE-REPORT"), "NOT_APPLICABLE");
  assert.equal(cls(c, "BP-382.705A-CONFIRM-MRO-REPORT"), "BEST_PRACTICE");
  assert.equal(cls(c, "FED-40.307-FOLLOW-UP-TESTING"), "CONDITIONALLY_REQUIRED");
});

test("violation: undecided return-to-duty leaves RTD items undetermined", () => {
  const c = viol({ violationType: "ALCOHOL_04", willReturnToDuty: "UNDECIDED" });
  assert.equal(cls(c, "FED-40.305-RTD-TEST"), "UNABLE_TO_DETERMINE");
});

test("violation: alcohol 0.02–0.039 is a 24-hour stand-down, not a violation", () => {
  const c = viol({ violationType: "ALCOHOL_02_TO_04" });
  assert.equal(cls(c, "FED-382.505-ALCOHOL-02-04"), "CONDITIONALLY_REQUIRED");
  assert.equal(cls(c, "FED-382.501-IMMEDIATE-REMOVAL"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-382.705B-EMPLOYER-CLEARINGHOUSE-REPORT"), "NOT_APPLICABLE");
  assert.equal(cls(c, "FED-40.287-SAP-LIST"), "NOT_APPLICABLE");
});

// ───── Scenario catalog ─────

test("scenario catalog: 53 scenarios, live ones point at real workflows with valid presets", () => {
  assert.equal(SCENARIOS.length, 53);
  assert.deepEqual(SCENARIOS.map((s) => s.n).sort((a, b) => a - b), Array.from({ length: 53 }, (_, i) => i + 1));
  for (const s of SCENARIOS.filter((s) => s.status === "LIVE")) {
    const def = WORKFLOWS[s.workflow!];
    assert.ok(def, `scenario ${s.n}`);
    for (const k of Object.keys(s.preset ?? {})) assert.ok(def.questions.some((q) => q.id === k), `scenario ${s.n} preset ${k}`);
  }
  for (const s of SCENARIOS.filter((s) => s.status === "PLANNED")) assert.ok(s.phase, `scenario ${s.n} has a phase`);
});
