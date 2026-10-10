import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChecklist, ValidationError } from "../src/lib/workflows/checklist";
import { WORKFLOWS, type Answers } from "../src/lib/workflows/definitions";
import { SCENARIOS, VISIBLE_SCENARIOS } from "../src/lib/workflows/scenarios";
import { rulesFor, validateCatalog } from "../src/lib/rules/catalog";
import { searchScenarios } from "../src/lib/search/scenario-search";
import type { Classification, WorkflowKey } from "../src/lib/rules/types";

/**
 * Batch 2 (catalog 2026.10.2): short-haul status, ELD malfunction, tickets and convictions,
 * vehicle inspection and maintenance, random test selection — plus additions to the
 * hours-of-service and roadside workflows.
 */

const org = { baseState: "TX", preEmploymentAlcoholTesting: false };
const run = (key: WorkflowKey, a: Answers) => generateChecklist(WORKFLOWS[key], a, org);
type C = ReturnType<typeof run>;
const cls = (c: C, id: string): Classification | undefined => c.items.find((i) => i.ruleId === id)?.classification;
const item = (c: C, id: string) => c.items.find((i) => i.ruleId === id)!;
const applies = (c: C, id: string) => ["LEGALLY_REQUIRED", "CONDITIONALLY_REQUIRED"].includes(cls(c, id) ?? "");
const NA = "NOT_APPLICABLE";
const UNDETERMINED = "UNABLE_TO_DETERMINE";

// ───────────────────────── Hours of service additions ─────────────────────────

test("HOS: coercion rule appears only when dispatch or the schedule was the cause", () => {
  const base = { situation: "ABOUT_TO", vehicleType: "PROPERTY", operationType: "INTERSTATE", foundBy: "INTERNAL" };
  assert.ok(applies(run("HOS_VIOLATION", { ...base, cause: "DISPATCH" }), "FED-390.6-COERCION"));
  assert.equal(cls(run("HOS_VIOLATION", { ...base, cause: "DRIVER" }), "FED-390.6-COERCION"), NA);
  assert.equal(cls(run("HOS_VIOLATION", { ...base, cause: "DISPATCH", operationType: "INTRASTATE", operatingState: "TX" }), "FED-390.6-COERCION"), UNDETERMINED);
});

// ───────────────────────── Short-haul ─────────────────────────

const sh = (a: Partial<Answers> = {}) => run("SHORT_HAUL_STATUS", { pattern: "ONE_DAY", cdlRequired: true, operationType: "INTERSTATE", logDays: "EIGHT_OR_FEWER", ...a });

test("short-haul: CDL vs non-CDL provisions are mutually exclusive", () => {
  const cdl = sh();
  assert.ok(applies(cdl, "FED-395.1E1-SHORT-HAUL-CONDITIONS"));
  assert.equal(cls(cdl, "FED-395.1E2-NON-CDL-SHORT-HAUL"), NA);
  const non = sh({ cdlRequired: false });
  assert.ok(applies(non, "FED-395.1E2-NON-CDL-SHORT-HAUL"));
  assert.equal(cls(non, "FED-395.1E1-SHORT-HAUL-CONDITIONS"), NA);
});

test("short-haul: 8 days or fewer → paper log allowed; more than 8 → ELD; not sure → neither is asserted", () => {
  const few = sh();
  assert.ok(applies(few, "FED-395.8A1-PAPER-LOG-ALLOWED"));
  assert.equal(cls(few, "FED-395.8A1-ELD-REQUIRED"), NA);
  const many = sh({ logDays: "MORE_THAN_EIGHT" });
  assert.ok(applies(many, "FED-395.8A1-ELD-REQUIRED"));
  assert.equal(cls(many, "FED-395.8A1-PAPER-LOG-ALLOWED"), NA);
  const unsure = sh({ logDays: "UNKNOWN" });
  assert.equal(cls(unsure, "FED-395.8A1-ELD-REQUIRED"), UNDETERMINED);
  assert.equal(cls(unsure, "FED-395.8A1-PAPER-LOG-ALLOWED"), UNDETERMINED);
});

test("short-haul: a permanent move to long-haul drops the exception steps and requires an ELD", () => {
  const c = run("SHORT_HAUL_STATUS", { pattern: "PERMANENT", cdlRequired: true, operationType: "INTERSTATE" });
  assert.ok(applies(c, "FED-395.3-FULL-RULES-LONG-HAUL"));
  assert.ok(applies(c, "FED-395.8A1-ELD-REQUIRED"));
  for (const id of ["FED-395.1E1-SHORT-HAUL-CONDITIONS", "FED-395.1E2-NON-CDL-SHORT-HAUL", "FED-395.1E-TIME-RECORDS", "FED-395.8A1-PAPER-LOG-ALLOWED"]) assert.equal(cls(c, id), NA, id);
  assert.equal(cls(sh(), "FED-395.3-FULL-RULES-LONG-HAUL"), NA);
  assert.ok(applies(sh(), "FED-395.1E-TIME-RECORDS"));
});

// ───────────────────────── ELD malfunction ─────────────────────────

const AT = "2026-10-01T12:00:00.000Z";
const eld = (a: Partial<Answers> = {}) => run("ELD_MALFUNCTION", { issueType: "MALFUNCTION", malfunctionAt: AT, operationType: "INTERSTATE", recordsAvailable: "NO", fixWithin8Days: "YES", ...a });

test("ELD: malfunction deadlines — 24 hours (driver notice), 8 days (repair), 5 days (extension request)", () => {
  const c = eld({ fixWithin8Days: "NO" });
  assert.equal(item(c, "FED-395.34A1-DRIVER-NOTICE").dueAt?.toISOString(), "2026-10-02T12:00:00.000Z");
  assert.equal(item(c, "FED-395.34D1-REPAIR-8-DAYS").dueAt?.toISOString(), "2026-10-09T12:00:00.000Z");
  assert.equal(item(c, "FED-395.34D2-EXTENSION-REQUEST").dueAt?.toISOString(), "2026-10-06T12:00:00.000Z");
  assert.ok(applies(c, "FED-395.34A3-PAPER-LOGS"));
});

test("ELD: reconstruction and extension steps depend on the answers", () => {
  assert.ok(applies(eld(), "FED-395.34A2-RECONSTRUCT"));
  assert.equal(cls(eld({ recordsAvailable: "YES" }), "FED-395.34A2-RECONSTRUCT"), NA);
  assert.equal(cls(eld({ recordsAvailable: "UNKNOWN" }), "FED-395.34A2-RECONSTRUCT"), UNDETERMINED);
  assert.equal(cls(eld(), "FED-395.34D2-EXTENSION-REQUEST"), NA);
  assert.equal(cls(eld({ fixWithin8Days: "UNKNOWN" }), "FED-395.34D2-EXTENSION-REQUEST"), UNDETERMINED);
});

test("ELD: a data diagnostic event is not treated as a malfunction; unknown type is not guessed", () => {
  const diag = run("ELD_MALFUNCTION", { issueType: "DATA_DIAGNOSTIC", malfunctionAt: AT, operationType: "INTERSTATE" });
  assert.ok(applies(diag, "FED-395.34C-DATA-DIAGNOSTIC"));
  for (const id of ["FED-395.34A1-DRIVER-NOTICE", "FED-395.34A2-RECONSTRUCT", "FED-395.34A3-PAPER-LOGS", "FED-395.34D1-REPAIR-8-DAYS", "FED-395.34D2-EXTENSION-REQUEST"]) assert.equal(cls(diag, id), NA, id);
  assert.equal(item(diag, "FED-395.34D1-REPAIR-8-DAYS").dueAt, null);

  const unsure = eld({ issueType: "UNKNOWN" });
  assert.equal(cls(unsure, "FED-395.34D1-REPAIR-8-DAYS"), UNDETERMINED);
  assert.equal(cls(unsure, "FED-395.34C-DATA-DIAGNOSTIC"), UNDETERMINED);
  assert.throws(() => eld({ malfunctionAt: new Date(Date.now() + 86_400_000).toISOString() }), ValidationError);
});

// ───────────────────────── Ticket / arrest / conviction ─────────────────────────

const cite = (a: Partial<Answers> = {}) =>
  run("DRIVER_CITATION", { offense: "SPEEDING_15", vehicle: "CMV", stage: "CITED", cdlHolder: true, licenseState: "TX", operationType: "INTERSTATE", licenseAction: "NO", ...a });

test("citation: a ticket alone creates no federal reporting duty; a conviction does", () => {
  const cited = cite();
  assert.equal(cls(cited, "BP-CITATION-REPORTING"), "BEST_PRACTICE");
  assert.equal(cls(cited, "FED-383.31-CONVICTION-NOTICE-TO-EMPLOYER"), NA);
  assert.equal(cls(cited, "FED-391.25-CONSIDER-AT-ANNUAL-REVIEW"), NA);
  const convicted = cite({ stage: "CONVICTED", priorSerious: "NO" });
  assert.ok(applies(convicted, "FED-383.31-CONVICTION-NOTICE-TO-EMPLOYER"));
  assert.ok(applies(convicted, "FED-391.25-CONSIDER-AT-ANNUAL-REVIEW"));
  assert.equal(cls(convicted, "BP-CITATION-REPORTING"), NA);
});

test("citation: serious violation — first conviction informs, second within 3 years disqualifies", () => {
  const first = cite({ stage: "CONVICTED", priorSerious: "NO" });
  assert.ok(applies(first, "FED-383.51C-SERIOUS-TRAFFIC-VIOLATION"));
  assert.equal(cls(first, "FED-383.51C-DISQUALIFICATION-DUE"), NA);
  const second = cite({ stage: "CONVICTED", priorSerious: "YES" });
  assert.ok(applies(second, "FED-383.51C-DISQUALIFICATION-DUE"));
  assert.ok(item(second, "FED-383.51C-DISQUALIFICATION-DUE").ruleSnapshot.prohibits);
  assert.equal(cls(cite({ stage: "CONVICTED", priorSerious: "UNKNOWN" }), "FED-383.51C-DISQUALIFICATION-DUE"), UNDETERMINED);
  // Not yet convicted → no disqualification step even with a prior.
  assert.equal(cls(cite({ stage: "CITED" }), "FED-383.51C-DISQUALIFICATION-DUE"), NA);
  // A minor violation is not on the serious list.
  const minor = cite({ offense: "MINOR", stage: "CONVICTED" });
  assert.equal(cls(minor, "FED-383.51C-SERIOUS-TRAFFIC-VIOLATION"), NA);
  assert.throws(() => cite({ stage: "CONVICTED" }), ValidationError, "prior-conviction question is required for a serious conviction");
});

test("citation: DUI in a CMV is actual knowledge (blocks safety-sensitive work); DUI in a personal vehicle is not", () => {
  const cmv = cite({ offense: "DUI", vehicle: "CMV" });
  assert.ok(applies(cmv, "FED-382.107-DUI-CMV-ACTUAL-KNOWLEDGE"));
  assert.equal(item(cmv, "FED-382.107-DUI-CMV-ACTUAL-KNOWLEDGE").blocksSafetySensitive, true);
  assert.equal(cls(cmv, "FED-382.107-DUI-PERSONAL-VEHICLE"), NA);
  assert.ok(applies(cmv, "FED-383.51B-MAJOR-OFFENSE"));

  const personal = cite({ offense: "DUI", vehicle: "PERSONAL" });
  assert.equal(cls(personal, "FED-382.107-DUI-CMV-ACTUAL-KNOWLEDGE"), NA);
  assert.ok(applies(personal, "FED-382.107-DUI-PERSONAL-VEHICLE"));
  assert.ok(applies(personal, "FED-383.51B-MAJOR-OFFENSE"), "a DUI conviction in a personal vehicle still disqualifies a CDL holder");
  assert.equal(item(personal, "FED-382.107-DUI-PERSONAL-VEHICLE").blocksSafetySensitive, false);

  const speeding = cite();
  assert.equal(cls(speeding, "FED-383.51B-MAJOR-OFFENSE"), NA);
  assert.equal(cls(speeding, "FED-382.107-DUI-CMV-ACTUAL-KNOWLEDGE"), NA);
});

test("citation: licence action and non-CDL branches", () => {
  assert.ok(applies(cite({ licenseAction: "YES" }), "FED-383.37-LICENSE-ACTION"));
  assert.equal(cls(cite(), "FED-383.37-LICENSE-ACTION"), NA);
  assert.equal(cls(cite({ licenseAction: "UNKNOWN" }), "FED-383.37-LICENSE-ACTION"), UNDETERMINED);
  const nonCdl = cite({ cdlHolder: false, offense: "DUI", vehicle: "PERSONAL", stage: "CONVICTED" });
  for (const id of ["FED-383.31-CONVICTION-NOTICE-TO-EMPLOYER", "FED-383.51B-MAJOR-OFFENSE", "FED-382.107-DUI-PERSONAL-VEHICLE"]) assert.equal(cls(nonCdl, id), NA, id);
  assert.equal(cls(cite(), "STATE-CITATION-CONSEQUENCES"), UNDETERMINED);
});

// ───────────────────────── Vehicle maintenance ─────────────────────────

const veh = (a: Answers) => run("VEHICLE_MAINTENANCE", { unitType: "POWER", operationType: "INTERSTATE", ...a });
const VEHICLE_IDS = rulesFor("VEHICLE_MAINTENANCE").map((r) => r.id);
const applicable = (c: C) => c.items.filter((i) => i.classification !== NA).map((i) => i.ruleId).sort();

test("vehicle: annual inspection expired", () => {
  const c = veh({ situation: "ANNUAL_EXPIRED" });
  assert.deepEqual(applicable(c), ["FED-396.17-GET-PERIODIC-INSPECTION", "FED-396.17C-NO-USE-WITHOUT-ANNUAL", "FED-396.21-INSPECTION-REPORT-ON-VEHICLE", "FED-396.3B3-RECORD-THE-REPAIR"]);
  assert.match(item(c, "FED-396.17C-NO-USE-WITHOUT-ANNUAL").ruleSnapshot.prohibits ?? "", /Using this vehicle/);
});

test("vehicle: defect reported branches on safety effect and on the one-vehicle exception", () => {
  const unsafe = veh({ situation: "DEFECT_REPORTED", defectAffectsSafety: "YES", oneVehicleCarrier: false });
  assert.ok(applies(unsafe, "FED-396.11A3-REPAIR-BEFORE-USE"));
  assert.ok(applies(unsafe, "FED-396.11A-DRIVER-DEFECT-REPORT"));
  assert.equal(cls(unsafe, "FED-396.11A3-REPAIR-UNNECESSARY"), NA);
  assert.equal(cls(unsafe, "FED-396.3-ONE-VEHICLE-CARRIER-DEFECT"), NA);

  const cosmetic = veh({ situation: "DEFECT_REPORTED", defectAffectsSafety: "NO", oneVehicleCarrier: false });
  assert.ok(applies(cosmetic, "FED-396.11A3-REPAIR-UNNECESSARY"));
  assert.equal(cls(cosmetic, "FED-396.11A3-REPAIR-BEFORE-USE"), NA);

  const unsure = veh({ situation: "DEFECT_REPORTED", defectAffectsSafety: "UNKNOWN", oneVehicleCarrier: false });
  assert.equal(cls(unsure, "FED-396.11A3-REPAIR-BEFORE-USE"), UNDETERMINED);
  assert.equal(cls(unsure, "FED-396.11A3-REPAIR-UNNECESSARY"), UNDETERMINED);

  const oneTruck = veh({ situation: "DEFECT_REPORTED", defectAffectsSafety: "YES", oneVehicleCarrier: true });
  assert.equal(cls(oneTruck, "FED-396.11A-DRIVER-DEFECT-REPORT"), NA, "DVIR rule does not apply to a one-CMV carrier");
  assert.ok(applies(oneTruck, "FED-396.3-ONE-VEHICLE-CARRIER-DEFECT"));
  assert.ok(applies(oneTruck, "FED-396.11A3-REPAIR-BEFORE-USE"), "the repair duty remains");
});

test("vehicle: breakdown — warning devices only when stopped on the highway", () => {
  const road = veh({ situation: "BREAKDOWN", stoppedOnHighway: true });
  assert.ok(applies(road, "FED-396.7-UNSAFE-OPERATION"));
  assert.ok(applies(road, "FED-392.22-STOPPED-VEHICLE-WARNINGS"));
  assert.equal(cls(veh({ situation: "BREAKDOWN", stoppedOnHighway: false }), "FED-392.22-STOPPED-VEHICLE-WARNINGS"), NA);
  assert.equal(cls(road, "BP-BREAKDOWN-LOGISTICS"), "BEST_PRACTICE");
});

test("vehicle: records and new-unit branches; unverified items are flagged", () => {
  const rec = veh({ situation: "RECORDS_MISSING", control30Days: "YES" });
  assert.ok(applies(rec, "FED-396.3B-REQUIRED-MAINTENANCE-RECORDS"));
  assert.equal(cls(rec, "BP-RECONSTRUCT-MAINTENANCE-RECORDS"), "BEST_PRACTICE");
  assert.equal(cls(veh({ situation: "RECORDS_MISSING", control30Days: "NO" }), "FED-396.3B-REQUIRED-MAINTENANCE-RECORDS"), NA);
  assert.equal(cls(veh({ situation: "RECORDS_MISSING", control30Days: "UNKNOWN" }), "FED-396.3B-REQUIRED-MAINTENANCE-RECORDS"), UNDETERMINED);

  const truck = veh({ situation: "NEW_UNIT", control30Days: "YES" });
  for (const id of ["FED-396.17-GET-PERIODIC-INSPECTION", "FED-396.21-INSPECTION-REPORT-ON-VEHICLE", "FED-396.3B-REQUIRED-MAINTENANCE-RECORDS", "FED-393.95-EMERGENCY-EQUIPMENT", "REVIEW-390.21-VEHICLE-MARKING", "REVIEW-NEW-UNIT-REGISTRATION"]) assert.ok(applies(truck, id), id);
  for (const id of ["REVIEW-390.21-VEHICLE-MARKING", "REVIEW-NEW-UNIT-REGISTRATION"]) assert.equal(item(truck, id).ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION", id);

  const trailer = veh({ situation: "NEW_UNIT", unitType: "TRAILER", control30Days: "YES" });
  assert.equal(cls(trailer, "FED-393.95-EMERGENCY-EQUIPMENT"), NA, "emergency equipment is a power-unit rule");
  assert.equal(cls(trailer, "REVIEW-390.21-VEHICLE-MARKING"), NA);
  assert.ok(applies(trailer, "FED-396.17-GET-PERIODIC-INSPECTION"), "a trailer needs its own periodic inspection");
});

test("vehicle: every rule is reachable, and each situation shows only its own steps", () => {
  const seen = new Set<string>();
  const cases: Answers[] = [
    { situation: "ANNUAL_EXPIRED" },
    { situation: "DEFECT_REPORTED", defectAffectsSafety: "YES", oneVehicleCarrier: false },
    { situation: "DEFECT_REPORTED", defectAffectsSafety: "NO", oneVehicleCarrier: false },
    { situation: "DEFECT_REPORTED", defectAffectsSafety: "YES", oneVehicleCarrier: true },
    { situation: "BREAKDOWN", stoppedOnHighway: true },
    { situation: "RECORDS_MISSING", control30Days: "YES" },
    { situation: "NEW_UNIT", control30Days: "YES" },
  ];
  for (const a of cases) for (const id of applicable(veh(a))) seen.add(id);
  assert.deepEqual([...seen].sort(), [...VEHICLE_IDS].sort());
  assert.ok(applicable(veh({ situation: "ANNUAL_EXPIRED" })).length < VEHICLE_IDS.length / 2);
});

test("vehicle: intrastate-only → Part 392/393/396 steps are not assumed", () => {
  const c = veh({ situation: "ANNUAL_EXPIRED", operationType: "INTRASTATE", operatingState: "TX" });
  assert.equal(cls(c, "FED-396.17C-NO-USE-WITHOUT-ANNUAL"), UNDETERMINED);
});

// ───────────────────────── Random test selection ─────────────────────────

const rnd = (reason: string, testType = "DRUG") => run("RANDOM_TEST_SELECTION", { reason, testType });

test("random: base rule always applies; alcohol timing only for alcohol tests", () => {
  const c = rnd("ON_THE_ROAD");
  assert.equal(cls(c, "FED-382.305I3-TEST-WITHIN-SELECTION-PERIOD"), "LEGALLY_REQUIRED");
  assert.equal(cls(c, "FED-382.305B-ANNUAL-RATE"), "LEGALLY_REQUIRED");
  assert.ok(applies(c, "FED-382.305L-NOTIFY-THEN-IMMEDIATELY"));
  assert.equal(cls(c, "FED-382.305M-ALCOHOL-TIMING"), NA);
  assert.ok(applies(rnd("SHORT_ABSENCE", "BOTH"), "FED-382.305M-ALCOHOL-TIMING"));
  assert.ok(applies(rnd("SHORT_ABSENCE", "ALCOHOL"), "FED-382.305M-ALCOHOL-TIMING"));
});

test("random: long absence and no-show are flagged for review rather than asserted", () => {
  const away = rnd("LONG_ABSENCE");
  assert.ok(applies(away, "REVIEW-RANDOM-LONG-ABSENCE"));
  assert.equal(item(away, "REVIEW-RANDOM-LONG-ABSENCE").ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION");
  assert.equal(cls(away, "FED-382.305L-NOTIFY-THEN-IMMEDIATELY"), NA);
  assert.equal(cls(away, "REVIEW-RANDOM-NO-SHOW"), NA);

  const noShow = rnd("NO_SHOW");
  assert.ok(applies(noShow, "REVIEW-RANDOM-NO-SHOW"));
  assert.equal(item(noShow, "REVIEW-RANDOM-NO-SHOW").ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION");
  assert.equal(cls(noShow, "REVIEW-RANDOM-LONG-ABSENCE"), NA);

  assert.equal(cls(rnd("LEFT_COMPANY"), "BP-RANDOM-LEFT-COMPANY"), "BEST_PRACTICE");
});

// ───────────────────────── Roadside: missing documents ─────────────────────────

test("roadside: the documents step appears only when a document was missing", () => {
  const base = { inspectionAt: "2026-10-01T15:00:00.000Z", inspectionState: "OH", operationType: "INTERSTATE", vehicleOos: false, driverOos: false, violationsFound: "YES", stateRequestedReturn: "NO" };
  assert.ok(applies(run("ROADSIDE_INSPECTION", { ...base, missingDocs: true }), "FED-ROADSIDE-REQUIRED-DOCUMENTS"));
  assert.equal(cls(run("ROADSIDE_INSPECTION", base), "FED-ROADSIDE-REQUIRED-DOCUMENTS"), NA, "optional question left blank means no");
  assert.equal(cls(run("ROADSIDE_INSPECTION", { ...base, missingDocs: false }), "FED-ROADSIDE-REQUIRED-DOCUMENTS"), NA);
});

// ───────────────────────── Catalog + scenario wiring + search ─────────────────────────

test("catalog: batch-2 rules are valid and record a verification date or a reason", () => {
  assert.deepEqual(validateCatalog(), []);
  for (const key of ["SHORT_HAUL_STATUS", "ELD_MALFUNCTION", "DRIVER_CITATION", "VEHICLE_MAINTENANCE", "RANDOM_TEST_SELECTION"] as WorkflowKey[]) {
    const rules = rulesFor(key);
    assert.ok(rules.length >= 7, `${key} has ${rules.length} rules`);
    for (const r of rules) {
      if (r.verificationStatus === "VERIFIED") assert.equal(r.lastVerified, "2026-10-09", r.id);
      else assert.ok(r.verificationNote, `${r.id} explains why it needs verification`);
      if (r.prohibits) assert.equal(r.blocksSafetySensitive, false, r.id);
    }
  }
});

test("the 17 batch-2 scenarios are live with valid presets, and every preset alone never crashes the generator", () => {
  const batch2 = [4, 13, 14, 16, 22, 32, 34, 35, 36, 38, 39, 40, 42, 43, 44, 45, 46];
  for (const n of batch2) {
    const s = SCENARIOS.find((x) => x.n === n)!;
    assert.equal(s.status, "LIVE", `scenario ${n} ${s.title}`);
    const def = WORKFLOWS[s.workflow!];
    for (const [k, v] of Object.entries(s.preset ?? {})) {
      const q = def.questions.find((x) => x.id === k);
      assert.ok(q, `scenario ${n}: preset key ${k} is not a question`);
      if (q!.options) assert.ok(q!.options.some((o) => o.value === v), `scenario ${n}: ${k}=${String(v)} is not an option`);
      if (q!.type === "boolean") assert.equal(typeof v, "boolean", `scenario ${n}: ${k}`);
    }
    // A preset is partial: the generator must ask for the rest (ValidationError), never throw anything else.
    try {
      generateChecklist(def, { ...(s.preset ?? {}) }, org);
    } catch (e) {
      assert.ok(e instanceof ValidationError, `scenario ${n} threw ${String(e)}`);
    }
  }
  // No two visible scenarios may share a workflow and identical preset (that would be a duplicate).
  const seen = new Map<string, number>();
  for (const s of VISIBLE_SCENARIOS.filter((x) => x.status === "LIVE")) {
    const key = `${s.workflow}|${JSON.stringify(Object.entries(s.preset ?? {}).sort())}`;
    assert.ok(!seen.has(key), `scenarios ${seen.get(key)} and ${s.n} are duplicates (${key})`);
    seen.set(key, s.n);
  }
});

test("search: plain-English phrases reach the batch-2 workflows", () => {
  const top = (q: string) => searchScenarios(q)[0]?.scenario;
  assert.equal(top("my driver's ELD stopped working")?.n, 42);
  assert.equal(top("driver got a speeding ticket")?.n, 13);
  assert.equal(top("driver was arrested for DUI off duty")?.n, 14);
  assert.equal(top("annual inspection expired on my trailer")?.n, 35);
  assert.equal(top("driver says the brakes are bad")?.n, 36);
  assert.equal(top("truck broke down on the highway")?.n, 38);
  assert.equal(top("we lost our maintenance records")?.n, 40);
  assert.equal(top("I'm buying a new truck")?.n, 34);
  assert.equal(top("adding a trailer")?.n, 39);
  assert.equal(top("driver was picked for a random drug test but is on vacation")?.n, 22);
  assert.equal(top("local driver went past 150 air miles")?.n, 43);
  assert.equal(top("dispatcher is pushing driver to run over hours")?.n, 46);
  assert.equal(top("driver stuck in a snow storm")?.n, 44);
  assert.equal(top("rehire a former driver")?.n, 4);
  assert.equal(top("driver didn't have his medical card at the scale")?.workflow, "ROADSIDE_INSPECTION");
  // Batch-1 phrases must still resolve correctly now that more scenarios are live.
  assert.equal(top("DOT pulled my truck over and found bad brakes.")?.workflow, "ROADSIDE_INSPECTION");
  assert.equal(top("My truck got put out of service.")?.n, 51);
  assert.equal(top("My driver ran out of hours.")?.workflow, "HOS_VIOLATION");
});
