import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChecklist, ValidationError } from "../src/lib/workflows/checklist";
import { WORKFLOWS, type Answers } from "../src/lib/workflows/definitions";
import { SCENARIOS, VISIBLE_SCENARIOS } from "../src/lib/workflows/scenarios";
import { SLUG_TO_KEY, scenarioHref } from "../src/lib/workflows/slugs";
import { rulesFor, validateCatalog } from "../src/lib/rules/catalog";
import { searchScenarios } from "../src/lib/search/scenario-search";
import { buildDependencyMap, impactOfProvision, provisionsForScenario } from "../src/lib/regulatory/dependencies";
import type { Classification, WorkflowKey } from "../src/lib/rules/types";

/**
 * Batch 3 (catalog 2026.10.3): the five company- and state-level workflows.
 * These tests pin which requirements appear for which answers — including the cases where a
 * requirement must NOT appear — and that each workflow is wired to its scenario card, search
 * and the regulatory dependency map.
 */

const org = { baseState: "TX", preEmploymentAlcoholTesting: false };
const run = (key: WorkflowKey, a: Answers) => generateChecklist(WORKFLOWS[key], a, org);
type C = ReturnType<typeof run>;
const cls = (c: C, id: string): Classification | undefined => c.items.find((i) => i.ruleId === id)?.classification;
const item = (c: C, id: string) => c.items.find((i) => i.ruleId === id)!;
const applies = (c: C, id: string) => ["LEGALLY_REQUIRED", "CONDITIONALLY_REQUIRED"].includes(cls(c, id) ?? "");
const NA = "NOT_APPLICABLE";
const UNDETERMINED = "UNABLE_TO_DETERMINE";
const top = (q: string) => searchScenarios(q)[0]?.scenario;
const depMap = buildDependencyMap();

/** Shared checks for a newly enabled scenario card. */
function assertWired(n: number, key: WorkflowKey, slug: string) {
  const s = SCENARIOS.find((x) => x.n === n)!;
  assert.equal(s.status, "LIVE", `scenario ${n} is enabled`);
  assert.equal(s.workflow, key);
  assert.equal(SLUG_TO_KEY[slug], key);
  assert.equal(scenarioHref(s), `/guide/${slug}?scenario=${n}`, "the card opens the right workflow");
  assert.equal(SCENARIOS.filter((x) => x.n === n).length, 1, "no duplicate card");
  for (const [k, v] of Object.entries(s.preset ?? {})) {
    const q = WORKFLOWS[key].questions.find((x) => x.id === k);
    assert.ok(q, `preset key ${k}`);
    if (q!.options) assert.ok(q!.options.some((o) => o.value === v), `preset ${k}=${String(v)}`);
  }
  // Every rule records a check date or says why it needs review; no rule claims a human review.
  for (const r of rulesFor(key)) {
    if (r.verificationStatus === "VERIFIED") assert.match(r.lastVerified ?? "", /^2026-10-(09|10)$/, r.id);
    else assert.ok(r.verificationNote, `${r.id} explains why it needs verification`);
    for (const src of r.sources) assert.match(src.url, /^https:\/\//, `${r.id} links an official https source`);
    if (r.prohibits) assert.equal(r.blocksSafetySensitive, false, r.id);
  }
  // Regulatory Intelligence: the scenario is reachable from the provisions its steps cite.
  const provisions = provisionsForScenario(s, undefined, depMap);
  assert.ok(provisions.length >= 3, `scenario ${n} maps to ${provisions.length} provisions`);
  assert.ok(impactOfProvision(provisions[0], undefined, depMap).scenarios.some((x) => x.n === n));
}

// ═════════════════════════ 1. Lease a truck temporarily ═════════════════════════

const lease = (a: Partial<Answers> = {}) =>
  run("LEASED_EQUIPMENT", { carrierType: "FOR_HIRE", lessorType: "RENTAL_COMPANY", withDriver: false, unitType: "POWER", term: "UP_TO_30", hazmat: false, operationType: "INTERSTATE", registrationState: "TX", ...a });
const REGIME_RULES = ["FED-376.1-PRIVATE-CARRIER-LESSEE", "FED-376.21-EXEMPT-LEASE", "FED-376.22-CARRIER-TO-CARRIER", "FED-376.11-FULL-LEASE-CONDITIONS"];
const onlyRegime = (c: C, expected: string) => {
  for (const id of REGIME_RULES) assert.equal(applies(c, id), id === expected, `${id} for expected ${expected}`);
};

test("lease: card, slug, sources and regulatory mapping", () => {
  assertWired(37, "LEASED_EQUIPMENT", "lease-a-truck");
  assert.ok(provisionsForScenario(SCENARIOS.find((s) => s.n === 37)!, undefined, depMap).includes("376.12"));
});

test("lease: an ordinary driverless rental by a for-hire carrier is exempt from the lease rules, but not from identification", () => {
  const c = lease();
  assert.equal(c.facts.leaseRegime, "EXEMPT");
  onlyRegime(c, "FED-376.21-EXEMPT-LEASE");
  assert.equal(cls(c, "FED-376.12-LEASE-CONTENTS"), NA, "no § 376.12 lease is demanded for an exempt rental");
  assert.equal(cls(c, "FED-376.11B-RETURN-OF-EQUIPMENT"), NA);
  assert.ok(applies(c, "FED-376.11C-IDENTIFY-EQUIPMENT"), "identification still applies under § 376.21");
});

test("lease: the same rental with the lessor's driver is NOT exempt — full lease rules and driver qualification apply", () => {
  const c = lease({ withDriver: true });
  assert.equal(c.facts.leaseRegime, "FULL");
  onlyRegime(c, "FED-376.11-FULL-LEASE-CONDITIONS");
  assert.ok(applies(c, "FED-376.12-LEASE-CONTENTS"));
  assert.ok(applies(c, "FED-390.5T-LESSOR-DRIVER-IS-YOUR-DRIVER"));
  assert.ok(item(c, "FED-390.5T-LESSOR-DRIVER-IS-YOUR-DRIVER").ruleSnapshot.prohibits);
  assert.equal(cls(lease(), "FED-390.5T-LESSOR-DRIVER-IS-YOUR-DRIVER"), NA, "no driver step when no driver is supplied");
});

test("lease: owner-operator, carrier-to-carrier, trailer-only and private-carrier branches", () => {
  const owner = lease({ lessorType: "OWNER", withDriver: true });
  assert.equal(owner.facts.leaseRegime, "FULL");
  assert.ok(applies(owner, "FED-376.11B-RETURN-OF-EQUIPMENT"));

  const carrier = lease({ lessorType: "AUTHORIZED_CARRIER" });
  assert.equal(carrier.facts.leaseRegime, "CARRIER_TO_CARRIER");
  onlyRegime(carrier, "FED-376.22-CARRIER-TO-CARRIER");
  assert.equal(cls(carrier, "FED-376.12-LEASE-CONTENTS"), NA);
  assert.ok(applies(carrier, "FED-376.11B-RETURN-OF-EQUIPMENT"));

  const trailer = lease({ lessorType: "OWNER", unitType: "TRAILER" });
  assert.equal(trailer.facts.leaseRegime, "EXEMPT", "a trailer pulled by the carrier's own tractor is exempt");
  assert.equal(cls(trailer, "FED-390.21T-MARK-LEASED-POWER-UNIT"), NA, "marking rules cover self-propelled vehicles");
  assert.equal(cls(trailer, "FED-390.21T-RENTED-30-DAYS"), NA);
  assert.ok(applies(trailer, "FED-396.17-LEASED-UNIT-PERIODIC-INSPECTION"), "a trailer still needs its own periodic inspection");

  const priv = lease({ carrierType: "PRIVATE" });
  assert.equal(priv.facts.leaseRegime, "NOT_SUBJECT");
  onlyRegime(priv, "FED-376.1-PRIVATE-CARRIER-LESSEE");
  assert.equal(cls(priv, "FED-376.11C-IDENTIFY-EQUIPMENT"), NA, "Part 376 identification is not imposed on a private carrier");
  assert.ok(applies(priv, "FED-396.3-LEASED-UNIT-MAINTENANCE"), "safety rules still apply to a private carrier");
});

test("lease: 30-day line — markings and the maintenance file", () => {
  const short = lease();
  assert.ok(applies(short, "FED-390.21T-RENTED-30-DAYS"));
  assert.equal(cls(short, "FED-390.21T-MARK-LEASED-POWER-UNIT"), NA);
  assert.equal(cls(short, "FED-396.3B-LEASED-UNIT-RECORDS"), NA, "no maintenance file required under 30 days");

  const long = lease({ term: "OVER_30" });
  assert.ok(applies(long, "FED-390.21T-MARK-LEASED-POWER-UNIT"));
  assert.equal(cls(long, "FED-390.21T-RENTED-30-DAYS"), NA);
  assert.ok(applies(long, "FED-396.3B-LEASED-UNIT-RECORDS"));
});

test("lease: federal insurance minimum applies to for-hire and hazmat carriers, not to a private non-hazmat carrier", () => {
  assert.ok(applies(lease(), "FED-387.7-FINANCIAL-RESPONSIBILITY-LEASED"));
  assert.equal(cls(lease({ carrierType: "PRIVATE" }), "FED-387.7-FINANCIAL-RESPONSIBILITY-LEASED"), NA);
  assert.ok(applies(lease({ carrierType: "PRIVATE", hazmat: true }), "FED-387.7-FINANCIAL-RESPONSIBILITY-LEASED"));
});

test("lease: unknown carrier type and intrastate operation are not guessed; state registration is flagged", () => {
  const unsure = lease({ carrierType: "UNKNOWN" });
  assert.equal(unsure.facts.leaseRegime, "UNKNOWN");
  for (const id of REGIME_RULES) assert.equal(cls(unsure, id), UNDETERMINED, id);
  assert.ok(applies(unsure, "FED-396.17-LEASED-UNIT-PERIODIC-INSPECTION"), "steps that do not depend on the answer still show");

  const intra = lease({ operationType: "INTRASTATE", operatingState: "TX" });
  assert.equal(cls(intra, "FED-376.21-EXEMPT-LEASE"), UNDETERMINED);
  assert.equal(cls(intra, "FED-396.17-LEASED-UNIT-PERIODIC-INSPECTION"), UNDETERMINED);

  assert.equal(cls(lease(), "STATE-LEASED-VEHICLE-REGISTRATION"), UNDETERMINED);
  assert.equal(item(lease(), "STATE-LEASED-VEHICLE-REGISTRATION").ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION");
  assert.throws(() => run("LEASED_EQUIPMENT", { carrierType: "FOR_HIRE" }), ValidationError);
});

test("lease: search finds the scenario", () => {
  assert.equal(top("I need to rent a truck for two weeks")?.n, 37);
  assert.equal(top("leasing a truck temporarily")?.n, 37);
  assert.equal(top("what has to be in a truck lease agreement")?.n, 37);
});

// ═════════════════════════ 2. Open a new trucking company ═════════════════════════

const startup = (a: Partial<Answers> = {}) =>
  run("NEW_CARRIER_STARTUP", { baseState: "TX", operationType: "INTERSTATE", cargo: "PROPERTY", forHire: "YES", vehicleWeight: "OVER_26000", hazmat: false, cdlDrivers: true, ownerDrives: false, multiState: true, ...a });

test("startup: card, slug, sources and regulatory mapping", () => {
  assertWired(47, "NEW_CARRIER_STARTUP", "start-a-trucking-company");
  const p = provisionsForScenario(SCENARIOS.find((s) => s.n === 47)!, undefined, depMap);
  for (const s of ["390.19T", "385.321", "387.9", "366.4T"]) assert.ok(p.includes(s), `maps to § ${s}`);
});

test("startup: interstate for-hire CDL carrier gets the full federal list", () => {
  const c = startup();
  for (const id of ["FED-390.19T-USDOT-NUMBER", "FED-385.305T-OPERATING-AUTHORITY", "FED-366.4T-PROCESS-AGENT", "FED-387.7-INSURANCE-BEFORE-OPERATING", "FED-382.115-TESTING-PROGRAM-FROM-DAY-ONE", "FED-391.51-DRIVER-FILES-FROM-FIRST-DRIVER", "FED-385.307-NEW-ENTRANT-PROGRAM", "FED-390.19T-BIENNIAL-UPDATE"])
    assert.ok(applies(c, id), id);
  assert.equal(cls(c, "FED-392.9A-PRIVATE-CARRIER-NO-AUTHORITY"), NA);
  assert.equal(cls(c, "FED-385.403-HAZMAT-SAFETY-PERMIT"), NA, "no hazmat step without hazmat");
  assert.equal(cls(c, "REVIEW-387-PASSENGER-INSURANCE"), NA);
  assert.equal(cls(c, "REVIEW-OWNER-OPERATOR-TESTING"), NA);
});

test("startup: a private carrier is not told to get operating authority, a process agent or federal liability minimums", () => {
  const c = startup({ forHire: "NO" });
  assert.ok(applies(c, "FED-392.9A-PRIVATE-CARRIER-NO-AUTHORITY"));
  for (const id of ["FED-385.305T-OPERATING-AUTHORITY", "FED-366.4T-PROCESS-AGENT", "FED-387.7-INSURANCE-BEFORE-OPERATING"]) assert.equal(cls(c, id), NA, id);
  assert.ok(applies(c, "FED-390.19T-USDOT-NUMBER"), "a USDOT number is still required");
  assert.ok(applies(c, "FED-382.115-TESTING-PROGRAM-FROM-DAY-ONE"));
  // …unless it hauls hazardous materials, which carry a federal minimum for private carriers too.
  assert.ok(applies(startup({ forHire: "NO", hazmat: true }), "FED-387.7-INSURANCE-BEFORE-OPERATING"));
});

test("startup: light vehicles, no CDL — commercial-vehicle and testing steps drop away", () => {
  const c = startup({ vehicleWeight: "UNDER_10001", cdlDrivers: false, multiState: false });
  assert.equal(c.facts.cmv, false);
  for (const id of ["FED-390.19T-USDOT-NUMBER", "FED-391.51-DRIVER-FILES-FROM-FIRST-DRIVER", "FED-396-MAINTENANCE-PROGRAM-STARTUP", "FED-395-HOURS-AND-RECORDS-STARTUP", "FED-385.307-NEW-ENTRANT-PROGRAM", "FED-382.115-TESTING-PROGRAM-FROM-DAY-ONE", "REVIEW-IRP-IFTA-HVUT"])
    assert.equal(cls(c, id), NA, id);
  assert.ok(c.warnings.some((w) => /not “commercial motor vehicles”/.test(w)));

  const mid = startup({ vehicleWeight: "FROM_10001", cdlDrivers: false });
  assert.ok(applies(mid, "FED-391.51-DRIVER-FILES-FROM-FIRST-DRIVER"), "10,001 lbs+ brings in driver qualification");
  assert.equal(cls(mid, "FED-382.115-TESTING-PROGRAM-FROM-DAY-ONE"), NA, "but not CDL drug and alcohol testing");
});

test("startup: hazmat, owner-driver and passenger branches", () => {
  const hm = startup({ hazmat: true });
  assert.ok(applies(hm, "FED-385.403-HAZMAT-SAFETY-PERMIT"));
  assert.ok(item(hm, "FED-385.403-HAZMAT-SAFETY-PERMIT").ruleSnapshot.prohibits);
  const owner = startup({ ownerDrives: true });
  assert.ok(applies(owner, "REVIEW-OWNER-OPERATOR-TESTING"));
  assert.equal(item(owner, "REVIEW-OWNER-OPERATOR-TESTING").ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION");
  const bus = startup({ cargo: "PASSENGERS" });
  assert.ok(applies(bus, "REVIEW-387-PASSENGER-INSURANCE"));
  assert.equal(cls(bus, "FED-387.7-INSURANCE-BEFORE-OPERATING"), NA, "property-carrier minimums are not shown to a passenger carrier");
});

test("startup: intrastate and undecided operations are not handed federal requirements as fact", () => {
  const intra = startup({ operationType: "INTRASTATE" });
  for (const id of ["FED-390.19T-USDOT-NUMBER", "FED-385.305T-OPERATING-AUTHORITY", "FED-385.307-NEW-ENTRANT-PROGRAM"]) assert.equal(cls(intra, id), UNDETERMINED, id);
  assert.ok(applies(intra, "FED-382.115-TESTING-PROGRAM-FROM-DAY-ONE"), "Part 382 applies to intrastate CDL drivers");
  assert.equal(cls(intra, "REVIEW-UCR-REGISTRATION"), NA, "UCR is for interstate carriers");
  assert.equal(cls(intra, "STATE-STARTUP-BUSINESS-AND-INTRASTATE"), UNDETERMINED);

  const unsure = startup({ forHire: "UNKNOWN" });
  assert.equal(cls(unsure, "FED-385.305T-OPERATING-AUTHORITY"), UNDETERMINED);
  assert.equal(cls(unsure, "FED-392.9A-PRIVATE-CARRIER-NO-AUTHORITY"), UNDETERMINED);
});

test("startup: no fee amounts are stated; contradictory answers are rejected", () => {
  for (const r of rulesFor("NEW_CARRIER_STARTUP")) {
    const text = [r.title, r.purpose, ...r.requiredAction, r.deadline.description, r.exceptions].join(" ");
    // The only dollar figures allowed are the insurance minimums printed in § 387.9.
    for (const m of text.match(/\$[\d,]+/g) ?? []) assert.ok(["$750,000", "$1,000,000", "$5,000,000"].includes(m), `${r.id} states ${m}`);
  }
  assert.throws(() => startup({ vehicleWeight: "OVER_26000", cdlDrivers: false }), ValidationError);
  assert.throws(() => startup({ hazmat: true, cdlDrivers: false, vehicleWeight: "UNDER_10001" }), ValidationError);
});

test("startup: search finds the scenario", () => {
  assert.equal(top("starting a new trucking company")?.n, 47);
  assert.equal(top("how do I get my own operating authority and USDOT number")?.n, 47);
  assert.equal(top("I want to open a trucking business")?.n, 47);
});

// ═════════════════════════ 3. DOT audit notice received ═════════════════════════

const audit = (a: Partial<Answers> = {}) =>
  run("AUDIT_NOTICE", { reviewType: "NEW_ENTRANT_AUDIT", issuer: "FMCSA", operationType: "INTERSTATE", reviewFormat: "REMOTE", carrierClass: "GENERAL", cdlDrivers: true, ...a });
const rating = (a: Partial<Answers> = {}) =>
  run("AUDIT_NOTICE", { reviewType: "RATING_NOTICE", issuer: "FMCSA", operationType: "INTERSTATE", carrierClass: "GENERAL", cdlDrivers: true, proposedRating: "UNSATISFACTORY", noticeReceivedAt: "2026-10-01", ...a });
const FIXED_PERIOD_RULES = ["FED-385.319C-CORRECTIVE-ACTION-60-DAYS", "FED-385.319C-CORRECTIVE-ACTION-45-DAYS", "FED-385.13-UNSATISFACTORY-60-DAYS", "FED-385.13-UNSATISFACTORY-45-DAYS", "FED-385.15-ADMIN-REVIEW-15-DAYS", "FED-385.15-ADMIN-REVIEW-90-DAYS"];

test("audit: card, slug, sources and regulatory mapping", () => {
  assertWired(49, "AUDIT_NOTICE", "dot-audit");
  const p = provisionsForScenario(SCENARIOS.find((s) => s.n === 49)!, undefined, depMap);
  for (const s of ["385.321", "385.15", "390.29", "391.51"]) assert.ok(p.includes(s), `maps to § ${s}`);
});

test("audit: a new-entrant safety audit shows its own steps and no rating or fixed-period steps", () => {
  const c = audit();
  for (const id of ["FED-385.337-DO-NOT-REFUSE-THE-AUDIT", "FED-385.311-NEW-ENTRANT-AUDIT-SCOPE", "FED-385.319-NEW-ENTRANT-AUDIT-OUTCOME", "FED-AUDIT-RECORD-CHECKLIST", "FED-390.29-PRODUCE-RECORDS-48-HOURS", "FED-AUDIT-DRUG-ALCOHOL-RECORDS"]) assert.ok(applies(c, id), id);
  for (const id of [...FIXED_PERIOD_RULES, "FED-385.11-PROPOSED-SAFETY-RATING", "FED-385.17-RATING-CHANGE-FOR-CORRECTIVE-ACTION", "REVIEW-STATE-AGENCY-AUDIT"]) assert.equal(cls(c, id), NA, id);
  assert.equal(cls(c, "BP-AUDIT-REMOTE-REVIEW"), "BEST_PRACTICE");
  assert.equal(cls(c, "BP-AUDIT-ONSITE-REVIEW"), NA);
  assert.equal(cls(audit({ reviewFormat: "ONSITE" }), "BP-AUDIT-ONSITE-REVIEW"), "BEST_PRACTICE");
  assert.ok(c.items.every((i) => i.dueAt === null), "no invented deadline: an audit notice has no computed due date");
});

test("audit: there is no universal deadline — only the notice's own dates, plus the 48-hour production rule", () => {
  for (const c of [audit(), audit({ reviewType: "COMPLIANCE_REVIEW" }), audit({ reviewType: "UNKNOWN" })]) {
    assert.equal(cls(c, "BP-AUDIT-DEADLINE-IS-IN-THE-NOTICE"), "BEST_PRACTICE");
    for (const id of FIXED_PERIOD_RULES) assert.notEqual(applies(c, id), true, id);
    assert.ok(c.warnings.some((w) => /no universal response deadline/.test(w)));
  }
  assert.match(item(audit(), "FED-390.29-PRODUCE-RECORDS-48-HOURS").ruleSnapshot.deadline.description, /48 hours/);
});

test("audit: compliance review explains ratings; drug and alcohol records only for CDL carriers", () => {
  const cr = audit({ reviewType: "COMPLIANCE_REVIEW" });
  assert.ok(applies(cr, "FED-385.11-PROPOSED-SAFETY-RATING"));
  assert.equal(cls(cr, "FED-385.311-NEW-ENTRANT-AUDIT-SCOPE"), NA);
  assert.equal(cls(cr, "FED-385.337-DO-NOT-REFUSE-THE-AUDIT"), NA);
  assert.equal(cls(audit({ cdlDrivers: false }), "FED-AUDIT-DRUG-ALCOHOL-RECORDS"), NA);
});

test("audit: corrective action notice — 60 days, or 45 for passenger and hazmat carriers, counted from the notice date", () => {
  const general = run("AUDIT_NOTICE", { reviewType: "CORRECTIVE_NOTICE", issuer: "FMCSA", operationType: "INTERSTATE", carrierClass: "GENERAL", cdlDrivers: true, noticeReceivedAt: "2026-10-01" });
  assert.ok(applies(general, "FED-385.319C-CORRECTIVE-ACTION-60-DAYS"));
  assert.equal(cls(general, "FED-385.319C-CORRECTIVE-ACTION-45-DAYS"), NA);
  assert.equal(item(general, "FED-385.319C-CORRECTIVE-ACTION-60-DAYS").dueAt?.toISOString().slice(0, 10), "2026-11-30");
  assert.ok(item(general, "FED-385.319C-CORRECTIVE-ACTION-60-DAYS").ruleSnapshot.prohibits);

  const hazmat = run("AUDIT_NOTICE", { reviewType: "CORRECTIVE_NOTICE", issuer: "FMCSA", operationType: "INTERSTATE", carrierClass: "PASSENGER_OR_HAZMAT", cdlDrivers: true, noticeReceivedAt: "2026-10-01" });
  assert.ok(applies(hazmat, "FED-385.319C-CORRECTIVE-ACTION-45-DAYS"));
  assert.equal(cls(hazmat, "FED-385.319C-CORRECTIVE-ACTION-60-DAYS"), NA);
  assert.equal(item(hazmat, "FED-385.319C-CORRECTIVE-ACTION-45-DAYS").dueAt?.toISOString().slice(0, 10), "2026-11-15");

  // Without the notice date the step still shows, but no date is made up.
  const undated = run("AUDIT_NOTICE", { reviewType: "CORRECTIVE_NOTICE", issuer: "FMCSA", operationType: "INTERSTATE", carrierClass: "GENERAL", cdlDrivers: true });
  assert.ok(applies(undated, "FED-385.319C-CORRECTIVE-ACTION-60-DAYS"));
  assert.equal(item(undated, "FED-385.319C-CORRECTIVE-ACTION-60-DAYS").dueAt, null);
  assert.ok(undated.warnings.some((w) => /Enter the date on the notice/.test(w)));
});

test("audit: proposed ratings — unsatisfactory vs conditional, general vs passenger/hazmat", () => {
  const unsat = rating();
  assert.ok(applies(unsat, "FED-385.13-UNSATISFACTORY-60-DAYS"));
  assert.equal(item(unsat, "FED-385.13-UNSATISFACTORY-60-DAYS").dueAt?.toISOString().slice(0, 10), "2026-11-30");
  assert.ok(applies(unsat, "FED-385.15-ADMIN-REVIEW-15-DAYS"));
  assert.equal(item(unsat, "FED-385.15-ADMIN-REVIEW-15-DAYS").dueAt?.toISOString().slice(0, 10), "2026-10-16");
  assert.equal(cls(unsat, "FED-385.15-ADMIN-REVIEW-90-DAYS"), NA);
  assert.ok(applies(unsat, "FED-385.17-RATING-CHANGE-FOR-CORRECTIVE-ACTION"));
  assert.ok(unsat.warnings.some((w) => /attorney/.test(w)), "professional help is flagged");

  const unsatHm = rating({ carrierClass: "PASSENGER_OR_HAZMAT" });
  assert.ok(applies(unsatHm, "FED-385.13-UNSATISFACTORY-45-DAYS"));
  assert.equal(cls(unsatHm, "FED-385.13-UNSATISFACTORY-60-DAYS"), NA);
  assert.equal(item(unsatHm, "FED-385.13-UNSATISFACTORY-45-DAYS").dueAt?.toISOString().slice(0, 10), "2026-11-15");

  const cond = rating({ proposedRating: "CONDITIONAL" });
  assert.ok(applies(cond, "FED-385.15-ADMIN-REVIEW-90-DAYS"));
  assert.equal(item(cond, "FED-385.15-ADMIN-REVIEW-90-DAYS").dueAt?.toISOString().slice(0, 10), "2026-12-30");
  for (const id of ["FED-385.13-UNSATISFACTORY-60-DAYS", "FED-385.13-UNSATISFACTORY-45-DAYS", "FED-385.15-ADMIN-REVIEW-15-DAYS"]) assert.equal(cls(cond, id), NA, id);
  assert.throws(() => rating({ proposedRating: undefined }), ValidationError);
});

test("audit: state notices and unknown review types are not given federal specifics as fact", () => {
  const state = audit({ issuer: "STATE" });
  assert.ok(applies(state, "REVIEW-STATE-AGENCY-AUDIT"));
  assert.equal(item(state, "REVIEW-STATE-AGENCY-AUDIT").ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION");
  assert.equal(cls(audit({ issuer: "UNKNOWN" }), "REVIEW-STATE-AGENCY-AUDIT"), UNDETERMINED);

  const unsure = audit({ reviewType: "UNKNOWN" });
  for (const id of ["FED-385.311-NEW-ENTRANT-AUDIT-SCOPE", "FED-385.11-PROPOSED-SAFETY-RATING", "FED-385.337-DO-NOT-REFUSE-THE-AUDIT"]) assert.equal(cls(unsure, id), UNDETERMINED, id);
  assert.ok(applies(unsure, "FED-385.3-WHAT-KIND-OF-REVIEW"));
  assert.ok(applies(unsure, "FED-AUDIT-RECORD-CHECKLIST"));
});

test("audit: search finds the scenario", () => {
  assert.equal(top("we got a DOT audit letter")?.n, 49);
  assert.equal(top("new entrant safety audit is scheduled")?.n, 49);
  assert.equal(top("we received a conditional safety rating")?.n, 49);
});

// ═════════════════════════ 4. Driver moves to another state ═════════════════════════

const move = (a: Partial<Answers> = {}) =>
  run("DRIVER_RELOCATION", { fromState: "TX", toState: "OK", domicileEstablished: "YES", domicileEstablishedOn: "2026-10-01", cdlHolder: true, licenseKind: "DOMICILED", hazmatEndorsement: false, medicalVariance: false, operationType: "INTERSTATE", ...a });
const TRANSFER = "FED-383.71C-TRANSFER-CDL-WITHIN-30-DAYS";

test("relocation: card, slug, sources and regulatory mapping", () => {
  assertWired(17, "DRIVER_RELOCATION", "driver-moves-state");
  const p = provisionsForScenario(SCENARIOS.find((s) => s.n === 17)!, undefined, depMap);
  for (const s of ["383.71", "383.5", "383.37", "391.25"]) assert.ok(p.includes(s), `maps to § ${s}`);
});

test("relocation: CDL holder with a new domicile has 30 days to apply, counted from the domicile date", () => {
  const c = move();
  assert.ok(applies(c, TRANSFER));
  assert.equal(item(c, TRANSFER).dueAt?.toISOString().slice(0, 10), "2026-10-31");
  assert.match(item(c, TRANSFER).ruleSnapshot.deadline.description, /30 days/);
  assert.ok(applies(c, "FED-383.37-ONE-VALID-CDL-DURING-TRANSFER"));
  assert.ok(item(c, "FED-383.37-ONE-VALID-CDL-DURING-TRANSFER").ruleSnapshot.prohibits);
  assert.ok(applies(c, "FED-383.5-STATE-OF-DOMICILE"));
  assert.equal(cls(c, "BP-RELOCATION-NOT-YET-DOMICILED"), NA);
  for (const id of ["FED-383.71C-HAZMAT-ENDORSEMENT-ON-TRANSFER", "REVIEW-NON-DOMICILED-CDL", "FED-391.11-NON-CDL-DRIVER-LICENSE", "FED-391.41-VARIANCE-AFTER-MOVE"]) assert.equal(cls(c, id), NA, id);

  // No date entered: the step shows, no date is made up, and the user is told why.
  const undated = move({ domicileEstablishedOn: undefined });
  assert.ok(applies(undated, TRANSFER));
  assert.equal(item(undated, TRANSFER).dueAt, null);
  assert.ok(undated.warnings.some((w) => /Enter the date/.test(w)));
});

test("relocation: no transfer step before domicile changes; unknown domicile is not guessed", () => {
  const planned = move({ domicileEstablished: "NO", domicileEstablishedOn: undefined });
  assert.equal(cls(planned, TRANSFER), NA);
  assert.equal(cls(planned, "BP-RELOCATION-NOT-YET-DOMICILED"), "BEST_PRACTICE");
  assert.ok(planned.items.every((i) => i.dueAt === null));

  const unsure = move({ domicileEstablished: "UNKNOWN" });
  assert.equal(cls(unsure, TRANSFER), UNDETERMINED);
  assert.ok(unsure.warnings.some((w) => /domicile has changed/.test(w)));
});

test("relocation: hazmat endorsement, non-domiciled CDL, non-CDL driver and medical variance branches", () => {
  const hm = move({ hazmatEndorsement: true });
  assert.ok(applies(hm, "FED-383.71C-HAZMAT-ENDORSEMENT-ON-TRANSFER"));
  assert.ok(item(hm, "FED-383.71C-HAZMAT-ENDORSEMENT-ON-TRANSFER").ruleSnapshot.prohibits);

  const nd = move({ licenseKind: "NON_DOMICILED" });
  assert.equal(cls(nd, TRANSFER), NA, "the 30-day transfer step is not asserted for a non-domiciled CDL");
  assert.notEqual(cls(nd, "REVIEW-NON-DOMICILED-CDL"), NA);
  assert.equal(item(nd, "REVIEW-NON-DOMICILED-CDL").ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION");

  const nonCdl = move({ cdlHolder: false, licenseKind: undefined, hazmatEndorsement: undefined });
  assert.ok(applies(nonCdl, "FED-391.11-NON-CDL-DRIVER-LICENSE"));
  for (const id of [TRANSFER, "FED-383.37-ONE-VALID-CDL-DURING-TRANSFER", "FED-383.71C-HAZMAT-ENDORSEMENT-ON-TRANSFER", "REVIEW-NON-DOMICILED-CDL", "FED-391.51-MEDICAL-STATUS-ON-NEW-RECORD"]) assert.equal(cls(nonCdl, id), NA, id);
  assert.ok(nonCdl.items.every((i) => i.dueAt === null), "no federal transfer deadline is invented for a non-CDL licence");

  assert.ok(applies(move({ medicalVariance: true }), "FED-391.41-VARIANCE-AFTER-MOVE"));
});

test("relocation: the new State's procedure is never asserted, and intrastate carriers keep the Part 383 steps", () => {
  const c = move();
  const st = item(c, "STATE-NEW-STATE-LICENSING-PROCEDURE");
  assert.equal(st.classification, UNDETERMINED);
  assert.equal(st.ruleSnapshot.verificationStatus, "REQUIRES_VERIFICATION");
  assert.equal(st.ruleSnapshot.stateDependent?.stateFact, "toState");
  assert.ok(c.warnings.some((w) => /not loaded/.test(w)));

  const intra = move({ operationType: "INTRASTATE", operatingState: "OK" });
  assert.ok(applies(intra, TRANSFER), "Part 383 applies in intrastate commerce");
  assert.equal(cls(intra, "FED-391.25-RECORDS-FROM-BOTH-STATES"), UNDETERMINED);

  assert.throws(() => move({ toState: "TX" }), ValidationError);
  assert.throws(() => move({ licenseKind: undefined }), ValidationError);
});

test("relocation: search finds the scenario", () => {
  assert.equal(top("my driver moved to another state")?.n, 17);
  assert.equal(top("driver needs to transfer his CDL to a new state")?.n, 17);
  assert.equal(top("driver is relocating")?.n, 17);
});

// ═════════════════════════ 5. Expand operations into another state ═════════════════════════

const expand = (a: Partial<Answers> = {}) =>
  run("STATE_EXPANSION", { baseState: "TX", newState: "OK", currentScope: "ALREADY_INTERSTATE", intrastateInNewState: "NO", forHire: "YES", hasAuthority: "YES", hazmat: false, oversize: false, terminal: false, ...a });
const EXPANSION_REVIEW = ["REVIEW-IRP-NEW-STATE", "REVIEW-IFTA-NEW-STATE", "REVIEW-UCR-ON-EXPANSION"];
const EXPANSION_STATE = ["STATE-INTRASTATE-AUTHORITY-IN-NEW-STATE", "STATE-PERMITS-TAXES-SIZE-WEIGHT", "STATE-OVERSIZE-OVERWEIGHT-PERMITS", "STATE-TERMINAL-BUSINESS-REGISTRATION", "STATE-HAZMAT-PERMITS-AND-ROUTES"];

test("expansion: card, slug, sources and regulatory mapping", () => {
  assertWired(48, "STATE_EXPANSION", "expand-to-another-state");
  const p = provisionsForScenario(SCENARIOS.find((s) => s.n === 48)!, undefined, depMap);
  for (const s of ["392.2", "392.9a", "366.4T", "387.7", "390.29"]) assert.ok(p.includes(s), `maps to § ${s}`);
});

test("expansion: an existing interstate for-hire carrier is not told to get new federal authority", () => {
  const c = expand();
  for (const id of ["FED-390.5T-INTERSTATE-VS-INTRASTATE-IN-NEW-STATE", "FED-392.2-NEW-STATE-LAWS-APPLY", "FED-392.9A-EXISTING-AUTHORITY-SCOPE", "FED-366.4T-PROCESS-AGENT-COVERS-NEW-STATE", "FED-387.7-INSURANCE-IN-NEW-STATE"]) assert.ok(applies(c, id), id);
  for (const id of ["FED-392.9A-NO-AUTHORITY-YET", "FED-390.19T-FIRST-TIME-INTERSTATE", "FED-385.403-HAZMAT-SAFETY-PERMIT-NEW-STATE", "FED-390.29-RECORDS-AT-NEW-TERMINAL"]) assert.equal(cls(c, id), NA, id);
  assert.equal(cls(c, "BP-EXPANSION-UPDATE-USDOT-RECORD"), "BEST_PRACTICE");
  assert.ok(c.items.every((i) => i.dueAt === null), "no computed deadlines");
  assert.ok(!c.items.some((i) => applies(c, i.ruleId) && i.ruleSnapshot.prohibits), "nothing is prohibited for a carrier already authorized");
});

test("expansion: first interstate operation and missing authority are stop-and-fix items", () => {
  const first = expand({ currentScope: "INTRASTATE_ONLY_NOW", hasAuthority: "NO" });
  assert.ok(applies(first, "FED-390.19T-FIRST-TIME-INTERSTATE"));
  assert.ok(applies(first, "FED-392.9A-NO-AUTHORITY-YET"));
  assert.ok(item(first, "FED-392.9A-NO-AUTHORITY-YET").ruleSnapshot.prohibits);
  assert.equal(cls(first, "FED-392.9A-EXISTING-AUTHORITY-SCOPE"), NA);
  assert.equal(cls(first, "BP-EXPANSION-UPDATE-USDOT-RECORD"), NA);
  assert.ok(first.warnings.some((w) => /first interstate operation/.test(w)));
  assert.ok(first.warnings.some((w) => /Do not haul a for-hire load/.test(w)));

  const unsure = expand({ hasAuthority: "UNKNOWN" });
  assert.equal(cls(unsure, "FED-392.9A-EXISTING-AUTHORITY-SCOPE"), UNDETERMINED);
  assert.equal(cls(unsure, "FED-392.9A-NO-AUTHORITY-YET"), UNDETERMINED);
});

test("expansion: a private carrier is not given for-hire authority, process-agent or insurance-minimum steps", () => {
  const c = expand({ forHire: "NO", hasAuthority: undefined });
  for (const id of ["FED-392.9A-EXISTING-AUTHORITY-SCOPE", "FED-392.9A-NO-AUTHORITY-YET", "FED-366.4T-PROCESS-AGENT-COVERS-NEW-STATE", "FED-387.7-INSURANCE-IN-NEW-STATE"]) assert.equal(cls(c, id), NA, id);
  assert.ok(applies(c, "FED-392.2-NEW-STATE-LAWS-APPLY"));
  assert.ok(applies(expand({ forHire: "NO", hasAuthority: undefined, hazmat: true }), "FED-387.7-INSURANCE-IN-NEW-STATE"), "hazmat brings the insurance minimum back");
  assert.throws(() => expand({ hasAuthority: undefined }), ValidationError);
});

test("expansion: hazmat, oversize and terminal branches", () => {
  const c = expand({ hazmat: true, oversize: true, terminal: true });
  assert.ok(applies(c, "FED-385.403-HAZMAT-SAFETY-PERMIT-NEW-STATE"));
  assert.ok(applies(c, "FED-390.29-RECORDS-AT-NEW-TERMINAL"));
  assert.match(item(c, "FED-390.29-RECORDS-AT-NEW-TERMINAL").ruleSnapshot.deadline.description, /48 hours/);
  for (const id of ["STATE-HAZMAT-PERMITS-AND-ROUTES", "STATE-OVERSIZE-OVERWEIGHT-PERMITS", "STATE-TERMINAL-BUSINESS-REGISTRATION"]) assert.equal(cls(c, id), UNDETERMINED, id);
  const plain = expand();
  for (const id of ["STATE-HAZMAT-PERMITS-AND-ROUTES", "STATE-OVERSIZE-OVERWEIGHT-PERMITS", "STATE-TERMINAL-BUSINESS-REGISTRATION", "STATE-INTRASTATE-AUTHORITY-IN-NEW-STATE"]) assert.equal(cls(plain, id), NA, id);
});

test("expansion: State, IRP, IFTA and UCR items are flagged for verification and quote no fees or dates", () => {
  const c = expand({ intrastateInNewState: "YES", hazmat: true, oversize: true, terminal: true });
  assert.equal(cls(c, "STATE-INTRASTATE-AUTHORITY-IN-NEW-STATE"), UNDETERMINED);
  assert.ok(c.warnings.some((w) => /does not authorize point-to-point hauling/.test(w)));
  assert.equal(cls(expand({ intrastateInNewState: "UNKNOWN" }), "STATE-INTRASTATE-AUTHORITY-IN-NEW-STATE"), UNDETERMINED);
  for (const id of [...EXPANSION_REVIEW, ...EXPANSION_STATE]) {
    const r = item(c, id).ruleSnapshot;
    assert.equal(r.verificationStatus, "REQUIRES_VERIFICATION", id);
    assert.equal(r.lastVerified, null, id);
    assert.ok(r.verificationNote, id);
    assert.equal(r.deadline.anchor, undefined, id);
    const text = [r.title, r.purpose, ...r.requiredAction, r.deadline.description].join(" ");
    assert.doesNotMatch(text, /\$\s?\d/, `${id} quotes no fee`);
    assert.doesNotMatch(text, /\b\d+\s+(calendar |business )?(days?|months?|hours?)\b/, `${id} quotes no State deadline`);
  }
  for (const id of EXPANSION_STATE) assert.equal(item(c, id).ruleSnapshot.stateDependent?.stateFact, "newState", id);
  assert.ok(c.warnings.some((w) => /No fees/.test(w)));
  assert.throws(() => expand({ newState: "TX" }), ValidationError);
});

test("expansion: search finds the scenario", () => {
  assert.equal(top("we want to expand into another state")?.n, 48);
  assert.equal(top("do I need IFTA and IRP for a new state")?.n, 48);
  assert.equal(top("start running loads in a new state")?.n, 48);
});

// ═════════════════════════ Whole-library invariants ═════════════════════════

test("library: catalog valid, no duplicate or deleted scenarios, existing workflows untouched", () => {
  assert.deepEqual(validateCatalog(), []);
  assert.equal(SCENARIOS.length, 53, "no scenario records were added or removed");
  assert.deepEqual(SCENARIOS.map((s) => s.n).sort((a, b) => a - b), Array.from({ length: 53 }, (_, i) => i + 1));
  const seen = new Map<string, number>();
  for (const s of VISIBLE_SCENARIOS.filter((x) => x.status === "LIVE")) {
    const key = `${s.workflow}|${JSON.stringify(Object.entries(s.preset ?? {}).sort())}`;
    assert.ok(!seen.has(key), `scenarios ${seen.get(key)} and ${s.n} are duplicates`);
    seen.set(key, s.n);
  }
  // An existing workflow still produces the same shape of result.
  const c = run("DRUG_ALCOHOL_VIOLATION", { violationType: "POSITIVE_DRUG", determinationAt: "2026-10-01T12:00:00.000Z", willReturnToDuty: "NO" });
  assert.ok(c.items.length > 5);
});
