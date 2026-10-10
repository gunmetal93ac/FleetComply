import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChecklist } from "../src/lib/workflows/checklist";
import { WORKFLOWS, type Answers } from "../src/lib/workflows/definitions";
import { SCENARIOS } from "../src/lib/workflows/scenarios";
import { ALL_RULES } from "../src/lib/rules/catalog";
import {
  CHECKLIST_LABELS,
  IMMEDIATE_SAFETY_RULE_IDS,
  checklistProgress,
  isActionable,
  isEmergency,
  nextActions,
  orderForDisplay,
  priorityOf,
  safetyStepsBeforeQuestions,
  type Prioritizable,
} from "../src/lib/workflows/priority";
import { CHECKED_NOTE, checkboxRequests, isCheckedOff, transition, TransitionError, type ItemState, type ItemStatus } from "../src/lib/workflows/status";
import { emptyDraft, loadDraft, saveDraft, setDraftAnswer, visibleAnswers, type StorageLike } from "../src/lib/workflows/answer-store";
import type { WorkflowKey } from "../src/lib/rules/types";

// The simplified, prioritized checklist: ordering and labels only. These tests also pin that
// prioritizing never changes what the rules engine decided.

const org = { baseState: "TX", preEmploymentAlcoholTesting: false };

const ANSWERS: Record<string, { key: WorkflowKey; scenario: number; answers: Answers }> = {
  accident: { key: "DOT_ACCIDENT_RESPONSE", scenario: 26, answers: { accidentAt: "2026-10-08T14:00:00.000Z", accidentState: "CA", onlyBoardingOrCargo: false, fatality: false, injuryTreatedAway: true, towAway: true, driverCited: "YES", hazmatInvolved: true, hazmatReleased: true, nrcTrigger: "YES" } },
  brakes: { key: "VEHICLE_MAINTENANCE", scenario: 36, answers: { situation: "DEFECT_REPORTED", unitType: "POWER", operationType: "INTERSTATE", defectAffectsSafety: "YES", oneVehicleCarrier: false } },
  breakdown: { key: "VEHICLE_MAINTENANCE", scenario: 38, answers: { situation: "BREAKDOWN", unitType: "POWER", operationType: "INTERSTATE", stoppedOnHighway: true } },
  hire: {
    key: "HIRE_CDL_DRIVER",
    scenario: 2,
    answers: {
      companyState: "TX", licenseState: "OK", operatingState: "TX", operationType: "INTERSTATE", cdlVehicle: true, cdlClass: "A", hazmat: false, passengers: false, tankOrDoublesAssignment: "NO",
      dotTesting: "YES", experience: "EXPERIENCED", priorDotEmployment: "YES", nonFmcsaDotEmployer: "NO", priorViolation: "NO", preEmploymentTestException: "NO", exemption: "NONE", employmentStartDate: "2026-11-02",
    },
  },
  annual: { key: "VEHICLE_MAINTENANCE", scenario: 35, answers: { situation: "ANNUAL_EXPIRED", unitType: "TRAILER", operationType: "INTERSTATE" } },
};

type Item = Prioritizable & { title: string };
function build(name: keyof typeof ANSWERS, answers: Answers = ANSWERS[name].answers) {
  const c = generateChecklist(WORKFLOWS[ANSWERS[name].key], answers, org);
  const all: Item[] = c.items.map((i) => ({ ruleId: i.ruleId, rule: i.ruleSnapshot, classification: i.classification, dueAt: i.dueAt, title: i.title }));
  const emergency = isEmergency(c.workflowKey, c.facts);
  const actions = orderForDisplay(all.filter(isActionable), emergency);
  return { c, all, emergency, actions, ids: actions.map((i) => i.ruleId), tier: (id: string) => priorityOf(all.find((i) => i.ruleId === id)!).tier };
}
const NOW = new Date("2026-10-08T14:20:00.000Z"); // twenty minutes after the accident

test("prioritizing never changes what applies, the rule text, the citations or the deadlines", () => {
  for (const name of Object.keys(ANSWERS) as Array<keyof typeof ANSWERS>) {
    const { c, all, actions } = build(name);
    const applicable = c.items.filter((i) => i.classification !== "NOT_APPLICABLE");
    assert.deepEqual([...actions.map((i) => i.ruleId)].sort(), applicable.map((i) => i.ruleId).sort(), `${name}: no step added or dropped`);
    for (const a of all) {
      const src = c.items.find((i) => i.ruleId === a.ruleId)!;
      assert.equal(a.rule, src.ruleSnapshot, "the same rule object — nothing rewritten");
      assert.equal(a.dueAt, src.dueAt);
      assert.deepEqual(a.rule.sources, ALL_RULES.find((r) => r.id === a.ruleId)!.sources, `${a.ruleId} keeps its citations and source links`);
    }
  }
});

test("accident: emergency layout — safety first, then time-sensitive steps by earliest deadline", () => {
  const { emergency, ids, tier, actions } = build("accident");
  assert.ok(emergency);
  assert.equal(ids[0], "BP-ACC-IMMEDIATE-RESPONSE");
  assert.equal(tier("BP-ACC-IMMEDIATE-RESPONSE"), 1);
  const tiers = ids.map(tier);
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b), "grouped by tier");

  // Deadlines inside the time-sensitive tier: 1 h, 2 h, 12 h, 32 h, 30 days — as the rules state them.
  const timed = actions.filter((i) => priorityOf(i).tier === 3 && i.dueAt).map((i) => i.ruleId);
  assert.deepEqual(timed, ["FED-382.209-NO-ALCOHOL-AFTER-ACCIDENT", "FED-382.303-POST-ACCIDENT-ALCOHOL", "FED-171.15-NRC-IMMEDIATE-NOTICE", "FED-382.303-POST-ACCIDENT-DRUG", "FED-171.16-WRITTEN-HAZMAT-REPORT"]);
  const due = (id: string) => actions.find((i) => i.ruleId === id)!.dueAt!.toISOString();
  assert.equal(due("FED-382.303-POST-ACCIDENT-ALCOHOL"), "2026-10-08T16:00:00.000Z");
  assert.equal(due("FED-382.303-POST-ACCIDENT-DRUG"), "2026-10-09T22:00:00.000Z");
  assert.equal(due("FED-171.15-NRC-IMMEDIATE-NOTICE"), "2026-10-09T02:00:00.000Z");

  // "Preserve records — immediately" has no computed date but is time-sensitive by the rule's own wording.
  assert.equal(tier("FED-390.15A-ASSIST-INVESTIGATIONS"), 3);
  assert.equal(tier("FED-390.15B-ACCIDENT-REGISTER"), 3);
  assert.equal(tier("BP-ACC-INTERNAL-REVIEW"), 5);
});

test("accident: next action shows safety first, and never hides a deadline that is close", () => {
  const { actions } = build("accident");
  const done = new Set<string>();
  const next = () => nextActions(actions, (i) => ({ done: done.has(i.ruleId) }), NOW);

  let n = next();
  assert.deepEqual(n.primary.map((i) => i.ruleId), ["BP-ACC-IMMEDIATE-RESPONSE"]);
  const urgent = n.alsoUrgent.map((i) => i.ruleId);
  for (const id of ["FED-382.209-NO-ALCOHOL-AFTER-ACCIDENT", "FED-382.303-POST-ACCIDENT-ALCOHOL", "FED-171.15-NRC-IMMEDIATE-NOTICE"]) assert.ok(urgent.includes(id), `${id} is shown alongside, not held back`);
  assert.ok(!urgent.includes("FED-171.16-WRITTEN-HAZMAT-REPORT"), "a 30-day report is not presented as urgent");
  assert.ok(!urgent.includes("FED-382.303-POST-ACCIDENT-DRUG"), "32 hours away is beyond the 24-hour urgent window at this moment");

  // Completing the safety step moves on to the earliest deadline; the panel updates as boxes are ticked.
  done.add("BP-ACC-IMMEDIATE-RESPONSE");
  n = next();
  assert.deepEqual(n.primary.map((i) => i.ruleId), ["FED-382.209-NO-ALCOHOL-AFTER-ACCIDENT"]);
  done.add("FED-382.209-NO-ALCOHOL-AFTER-ACCIDENT");
  assert.deepEqual(next().primary.map((i) => i.ruleId), ["FED-382.303-POST-ACCIDENT-ALCOHOL"]);

  for (const a of actions) done.add(a.ruleId);
  n = next();
  assert.ok(n.allDone);
  assert.deepEqual(n.primary, []);
});

test("breakdown on the highway: warning devices are safety-first, the driving restriction comes with them", () => {
  const { emergency, ids, tier, actions } = build("breakdown");
  assert.ok(emergency);
  assert.equal(ids[0], "FED-392.22-STOPPED-VEHICLE-WARNINGS");
  assert.equal(tier("FED-396.7-UNSAFE-OPERATION"), 2);
  assert.equal(ids[1], "FED-396.7-UNSAFE-OPERATION");
  const n = nextActions(actions, () => ({ done: false }), NOW);
  assert.deepEqual(n.primary.map((i) => i.ruleId), ["FED-392.22-STOPPED-VEHICLE-WARNINGS"]);
  assert.ok(n.alsoUrgent.some((i) => i.ruleId === "FED-396.7-UNSAFE-OPERATION"), "the restriction is in effect at the same time");

  // Not stopped on the highway: the warning-device step does not apply and is not invented.
  const off = build("breakdown", { ...ANSWERS.breakdown.answers, stoppedOnHighway: false });
  assert.ok(!off.ids.includes("FED-392.22-STOPPED-VEHICLE-WARNINGS"));
  assert.equal(off.ids[0], "FED-396.7-UNSAFE-OPERATION");
});

test("defective brakes: a safety-affecting defect is an emergency with the repair-before-use restriction first", () => {
  const yes = build("brakes");
  assert.ok(yes.emergency);
  assert.equal(yes.ids[0], "FED-396.11A3-REPAIR-BEFORE-USE");
  assert.equal(yes.tier("FED-396.11A3-REPAIR-BEFORE-USE"), 2);
  assert.deepEqual(nextActions(yes.actions, () => ({ done: false }), NOW).primary.map((i) => i.ruleId), ["FED-396.11A3-REPAIR-BEFORE-USE"]);

  assert.ok(build("brakes", { ...ANSWERS.brakes.answers, defectAffectsSafety: "UNKNOWN" }).emergency, "not sure is treated as urgent, not as safe");
  const no = build("brakes", { ...ANSWERS.brakes.answers, defectAffectsSafety: "NO" });
  assert.equal(no.emergency, false);
  assert.ok(!no.ids.includes("FED-396.11A3-REPAIR-BEFORE-USE"));
});

test("routine workflows keep their stage order and get no emergency layout", () => {
  for (const name of ["hire", "annual"] as const) {
    const { c, emergency, ids } = build(name);
    assert.equal(emergency, false, name);
    assert.deepEqual(ids, c.items.filter((i) => i.classification !== "NOT_APPLICABLE").map((i) => i.ruleId), `${name}: catalog order unchanged`);
  }
  const annual = build("annual");
  assert.equal(annual.tier("FED-396.17C-NO-USE-WITHOUT-ANNUAL"), 2, "the no-use prohibition is still labelled a restriction");
  assert.deepEqual(nextActions(annual.actions, () => ({ done: false }), NOW).primary.map((i) => i.ruleId), ["FED-396.17C-NO-USE-WITHOUT-ANNUAL"]);

  const hire = build("hire");
  const blockers = hire.c.items.filter((i) => i.blocksSafetySensitive).map((i) => i.ruleId);
  assert.ok(blockers.length > 0);
  for (const id of blockers) assert.equal(hire.tier(id), 2, id);
  // Restrictions are shown together as the next action — they all apply at once.
  assert.deepEqual(nextActions(hire.actions, () => ({ done: false }), NOW).primary.map((i) => i.ruleId).sort(), hire.actions.filter((i) => priorityOf(i).tier === 2).map((i) => i.ruleId).sort());
});

test("emergency mode is decided by the workflow and the answers", () => {
  assert.equal(isEmergency("ROADSIDE_INSPECTION", { vehicleOos: true, driverOos: false }), true);
  assert.equal(isEmergency("ROADSIDE_INSPECTION", { vehicleOos: false, driverOos: true }), true);
  assert.equal(isEmergency("ROADSIDE_INSPECTION", { vehicleOos: false, driverOos: false }), false);
  assert.equal(isEmergency("DOT_ACCIDENT_RESPONSE", {}), true);
  assert.equal(isEmergency("VEHICLE_MAINTENANCE", { situation: "NEW_UNIT" }), false);
  assert.equal(isEmergency("AUDIT_NOTICE", {}), false);
});

test("every rule gets a tier with a stated basis; the hand-listed safety steps exist in the catalog", () => {
  const ids = new Set(ALL_RULES.map((r) => r.id));
  for (const id of IMMEDIATE_SAFETY_RULE_IDS) assert.ok(ids.has(id), `${id} is still in the catalog`);
  for (const r of ALL_RULES) {
    const p = priorityOf({ ruleId: r.id, rule: r, classification: "LEGALLY_REQUIRED", dueAt: null });
    assert.ok([1, 2, 3, 4, 5].includes(p.tier) && p.basis.length > 10, r.id);
    if (r.blocksSafetySensitive || r.prohibits) assert.ok(p.tier <= 2, `${r.id}: a prohibition is never ranked below restrictions`);
    if (r.deadline.anchor) assert.ok(p.tier <= 3, `${r.id}: a computed regulatory deadline is never ranked as documentation or follow-up`);
  }
  for (const t of [1, 2, 3, 4, 5] as const) assert.ok(CHECKLIST_LABELS.tier[t].name);
});

test("safety steps shown before the questions come from the catalog and only where the rules allow", () => {
  const preset = (n: number) => SCENARIOS.find((s) => s.n === n)!.preset ?? {};
  assert.deepEqual(safetyStepsBeforeQuestions("DOT_ACCIDENT_RESPONSE", preset(26)).map((r) => r.id), ["BP-ACC-IMMEDIATE-RESPONSE"]);
  assert.deepEqual(safetyStepsBeforeQuestions("VEHICLE_MAINTENANCE", preset(38)).map((r) => r.id), ["FED-392.22-STOPPED-VEHICLE-WARNINGS"]);
  assert.deepEqual(safetyStepsBeforeQuestions("VEHICLE_MAINTENANCE", preset(35)), [], "annual inspection: no roadside-warning step");
  assert.deepEqual(safetyStepsBeforeQuestions("VEHICLE_MAINTENANCE", preset(36)), [], "defective brakes: no roadside-warning step");
  assert.deepEqual(safetyStepsBeforeQuestions("HIRE_CDL_DRIVER", preset(2)), []);
});

test("progress counts applicable actions only and never says 'compliant'", () => {
  const { all, actions } = build("annual");
  const na = all.filter((i) => !isActionable(i));
  assert.ok(na.length > 0, "the vehicle workflow has not-applicable rules for this situation");
  const done = new Set([actions[0].ruleId, ...na.map((i) => i.ruleId)]); // ticking a not-applicable rule must not count
  const p = checklistProgress(all, (i) => done.has(i.ruleId));
  assert.equal(p.total, actions.length);
  assert.equal(p.done, 1);
  assert.equal(p.pct, Math.round(100 / actions.length));
  assert.equal(p.allDone, false);
  assert.equal(CHECKLIST_LABELS.progress(4, 10, 40), "4 of 10 actions completed — 40%");
  const full = checklistProgress(all, () => true);
  assert.ok(full.allDone);
  assert.equal(full.done, actions.length, "not-applicable rules are not counted as completed");
  assert.equal(CHECKLIST_LABELS.allDone, "All checklist actions completed");
  assert.doesNotMatch(JSON.stringify(CHECKLIST_LABELS), /compliant/i);
  assert.equal(checklistProgress([], () => true).allDone, false);
});

test("a blocked step is explained and the next performable step is offered instead", () => {
  const { actions } = build("annual");
  const first = actions[0].ruleId;
  const n = nextActions(actions, (i) => ({ done: false, blockedReason: i.ruleId === first ? "Waiting for the inspector" : null }), NOW);
  assert.deepEqual(n.blocked.map((b) => [b.item.ruleId, b.reason]), [[first, "Waiting for the inspector"]]);
  assert.ok(n.primary.length > 0 && !n.primary.some((i) => i.ruleId === first));
  const allBlocked = nextActions(actions, () => ({ done: false, blockedReason: "x" }), NOW);
  assert.deepEqual(allBlocked.primary, []);
  assert.equal(allBlocked.allDone, false);
});

// ───────────────────────── Checkbox on a saved checklist ─────────────────────────

const HR = { id: "user_hr", role: "HR" as const };
const SM = { id: "user_sm", role: "SAFETY_MANAGER" as const };
function tick(item: ItemState, checked: boolean, actor: { id: string; role: any }) {
  const events: Array<[ItemStatus, ItemStatus, string | null]> = [];
  let state = { ...item };
  for (const req of checkboxRequests(state.status, checked, "2026-10-10")) {
    const res = transition(state, req, actor);
    events.push([res.event.fromStatus, res.event.toStatus, res.event.note]);
    state = { ...state, ...res.patch } as ItemState;
  }
  return { state, events };
}
const fresh: ItemState = { status: "NOT_STARTED", classification: "LEGALLY_REQUIRED", evidenceCount: 0, notes: null };

test("checkbox: checking submits the step through the normal status rules, with history; it does not self-verify", () => {
  const { state, events } = tick(fresh, true, HR);
  assert.equal(state.status, "PENDING_VERIFICATION");
  assert.ok(isCheckedOff(state.status));
  assert.equal(state.completedById, HR.id);
  assert.equal(state.completionDate, "2026-10-10");
  assert.deepEqual(events, [["NOT_STARTED", "IN_PROGRESS", null], ["IN_PROGRESS", "PENDING_VERIFICATION", CHECKED_NOTE]]);
  assert.notEqual(state.status, "COMPLETED", "a tick is not a verification");
  assert.deepEqual(checkboxRequests("PENDING_VERIFICATION", true, "2026-10-10"), [], "already checked: nothing happens");
  assert.deepEqual(checkboxRequests("NOT_STARTED", false, "2026-10-10"), [], "viewing or unchecking an unchecked step changes nothing");
});

test("checkbox: unchecking an accidental tick works; a verified step needs a verifier to reopen", () => {
  const checked = tick(fresh, true, HR).state;
  const undone = tick(checked, false, HR);
  assert.equal(undone.state.status, "IN_PROGRESS");
  assert.equal(isCheckedOff(undone.state.status), false);

  const verified: ItemState = { ...checked, status: "COMPLETED" };
  assert.throws(() => tick(verified, false, HR), TransitionError);
  assert.equal(tick(verified, false, SM).state.status, "IN_PROGRESS");
  assert.throws(() => checkboxRequests("NOT_APPLICABLE", true, "2026-10-10"), TransitionError);
  assert.throws(() => tick(fresh, true, { id: "v", role: "VIEWER" }), TransitionError);
  assert.equal(tick({ ...fresh, status: "BLOCKED" }, true, HR).state.status, "PENDING_VERIFICATION");
});

// ───────────────────────── Answer transfer still feeds the prioritized checklist ─────────────────────────

test("answers carried from the guide produce the same prioritized checklist as answering directly", () => {
  const map = new Map<string, string>();
  const storage: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  for (const name of Object.keys(ANSWERS) as Array<keyof typeof ANSWERS>) {
    const { key, scenario, answers } = ANSWERS[name];
    const def = WORKFLOWS[key];
    let d = emptyDraft(key, scenario);
    for (const [id, v] of Object.entries(answers)) d = setDraftAnswer(d, id, v);
    saveDraft(storage, d);
    const carried = visibleAnswers(def, loadDraft(storage, def, scenario)!.answers);
    assert.deepEqual(carried, answers, `${name}: nothing to ask again`);
    const a = build(name, carried);
    const b = build(name);
    assert.deepEqual(a.ids, b.ids, `${name}: same actions in the same order`);
    assert.equal(a.emergency, b.emergency);
    assert.deepEqual(a.actions.map((i) => i.dueAt?.toISOString() ?? null), b.actions.map((i) => i.dueAt?.toISOString() ?? null));
  }
});
