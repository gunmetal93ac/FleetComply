import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChecklist, ValidationError } from "../src/lib/workflows/checklist";
import { WORKFLOWS, type Answers, type WorkflowDefinition } from "../src/lib/workflows/definitions";
import { SCENARIOS } from "../src/lib/workflows/scenarios";
import {
  DRAFT_MAX_AGE_DAYS,
  clearDraft,
  draftKey,
  emptyDraft,
  getPendingSave,
  isComplete,
  loadDraft,
  missingQuestions,
  parseDraft,
  sanitizeAnswers,
  saveDraft,
  setDraftAnswer,
  setPendingSave,
  summarizeAnswers,
  visibleAnswers,
  type StorageLike,
} from "../src/lib/workflows/answer-store";
import { planRevision, reviseRun, RevisionError, type ExistingItem } from "../src/lib/workflows/revise";
import { summarizeRun } from "../src/lib/workflows/review";
import { createMemoryDb, NotFoundError, TenantRepository } from "../src/lib/tenant/repository";
import { ForbiddenError } from "../src/lib/auth/rbac";
import { rulesFor } from "../src/lib/rules/catalog";
import type { RegulatoryRule, WorkflowKey } from "../src/lib/rules/types";

// Regression suite for "users are asked the same questions twice": the questionnaire's answers
// are one shared record, a checklist is built from it without re-asking, and answers on a saved
// checklist can be edited without losing completed work.

const org = { baseState: "TX", preEmploymentAlcoholTesting: false };

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

/** The six workflows named in the brief, each with a complete set of answers. */
const CASES: Array<{ name: string; key: WorkflowKey; scenario: number; answers: Answers }> = [
  {
    name: "Commercial vehicle accident",
    key: "DOT_ACCIDENT_RESPONSE",
    scenario: 26,
    answers: { accidentAt: "2026-10-08T14:00:00.000Z", accidentState: "CA", onlyBoardingOrCargo: false, fatality: false, injuryTreatedAway: true, towAway: true, driverCited: "NO", hazmatInvolved: false },
  },
  {
    name: "Driver reports defective brakes",
    key: "VEHICLE_MAINTENANCE",
    scenario: 36,
    answers: { situation: "DEFECT_REPORTED", unitType: "POWER", operationType: "INTERSTATE", defectAffectsSafety: "YES", oneVehicleCarrier: false },
  },
  {
    name: "Hiring a new CDL driver",
    key: "HIRE_CDL_DRIVER",
    scenario: 2,
    answers: {
      companyState: "TX", licenseState: "OK", operatingState: "TX", operationType: "INTERSTATE", cdlVehicle: true, cdlClass: "A", hazmat: false, passengers: false,
      tankOrDoublesAssignment: "NO", dotTesting: "YES", experience: "EXPERIENCED", priorDotEmployment: "YES", nonFmcsaDotEmployer: "NO", priorViolation: "NO",
      preEmploymentTestException: "NO", exemption: "NONE", employmentStartDate: "2026-11-02",
    },
  },
  { name: "Annual DOT inspection expires", key: "VEHICLE_MAINTENANCE", scenario: 35, answers: { situation: "ANNUAL_EXPIRED", unitType: "TRAILER", operationType: "INTERSTATE" } },
  {
    name: "DOT audit notice received",
    key: "AUDIT_NOTICE",
    scenario: 49,
    answers: { reviewType: "RATING_NOTICE", issuer: "FMCSA", operationType: "INTERSTATE", carrierClass: "GENERAL", cdlDrivers: true, proposedRating: "UNSATISFACTORY", noticeReceivedAt: "2026-10-01" },
  },
  {
    name: "Open a new trucking company",
    key: "NEW_CARRIER_STARTUP",
    scenario: 47,
    answers: { baseState: "TX", operationType: "INTERSTATE", cargo: "PROPERTY", forHire: "YES", vehicleWeight: "OVER_26000", hazmat: false, cdlDrivers: true, ownerDrives: true, multiState: true },
  },
];

/** Answer the questionnaire one question at a time, as the guide does, and store it. */
function fillDraft(storage: StorageLike, key: WorkflowKey, scenario: number | null, answers: Answers, built = true) {
  let d = emptyDraft(key, scenario);
  for (const [id, v] of Object.entries(answers)) d = setDraftAnswer(d, id, v);
  saveDraft(storage, { ...d, built });
  return d;
}
const shape = (c: ReturnType<typeof generateChecklist>) => c.items.map((i) => [i.ruleId, i.classification, i.status, i.dueAt?.toISOString() ?? null]);

// ───────────────────────── Answer transfer ─────────────────────────

for (const c of CASES) {
  test(`transfer — ${c.name}: the stored answers build the same checklist and nothing is asked again`, () => {
    const def = WORKFLOWS[c.key];
    const scenario = SCENARIOS.find((s) => s.n === c.scenario)!;
    assert.equal(scenario.workflow, c.key);
    // Preset answers from the scenario card are not asked either; the rest come from the visitor.
    const typed = Object.fromEntries(Object.entries(c.answers).filter(([k]) => !(k in (scenario.preset ?? {}))));
    const storage = memoryStorage();
    fillDraft(storage, c.key, c.scenario, typed);

    // The save page: same record, merged over the scenario's preset.
    const draft = loadDraft(storage, def, c.scenario)!;
    assert.ok(draft, "the answers are found by workflow + scenario");
    const carried: Answers = { ...(scenario.preset ?? {}), ...draft.answers };

    assert.deepEqual(missingQuestions(def, carried), [], "no question is asked a second time");
    assert.ok(isComplete(def, carried));
    assert.deepEqual(visibleAnswers(def, carried), c.answers, "every answer arrives with its original value and type");
    assert.deepEqual(shape(generateChecklist(def, visibleAnswers(def, carried), org)), shape(generateChecklist(def, c.answers, org)), "conditional steps match the original answers");
    assert.ok(draft.built);
    for (const id of Object.keys(typed)) assert.match(draft.answeredAt[id], /^\d{4}-\d\d-\d\dT/, `${id} has an answer timestamp`);
  });
}

test("transfer: yes/no, multiple choice, dates, date-times and states keep their types and language-independent values", () => {
  const storage = memoryStorage();
  const acc = CASES[0];
  fillDraft(storage, acc.key, acc.scenario, acc.answers);
  const raw = JSON.parse(storage.map.get(draftKey(acc.key, acc.scenario))!);
  assert.equal(raw.answers.injuryTreatedAway, true);
  assert.equal(raw.answers.fatality, false);
  assert.equal(raw.answers.driverCited, "NO");
  assert.equal(raw.answers.accidentState, "CA");
  assert.equal(raw.answers.accidentAt, "2026-10-08T14:00:00.000Z");
  assert.equal(raw.workflowKey, "DOT_ACCIDENT_RESPONSE");
  assert.equal(raw.scenario, 26);
  assert.ok(raw.sessionId);

  // Nothing stored is display text: no option label appears as a stored value in any case.
  for (const c of CASES) {
    const def = WORKFLOWS[c.key];
    const labels = new Set(def.questions.flatMap((q) => [q.label, ...(q.options ?? []).filter((o) => o.label !== o.value).map((o) => o.label)]));
    for (const v of Object.values(c.answers)) assert.ok(typeof v === "boolean" || !labels.has(String(v)), `${c.key}: ${String(v)} is a value, not a label`);
  }

  // The audit date (a plain date) survives exactly.
  const audit = CASES[4];
  fillDraft(storage, audit.key, audit.scenario, audit.answers);
  assert.equal(loadDraft(storage, WORKFLOWS[audit.key], audit.scenario)!.answers.noticeReceivedAt, "2026-10-01");
});

test("transfer: changing the display language cannot reset or change answers", () => {
  const acc = CASES[0];
  const def = WORKFLOWS[acc.key];
  const storage = memoryStorage();
  fillDraft(storage, acc.key, acc.scenario, acc.answers);
  // The same workflow with every label and option label reworded (as a translation would).
  const translated: WorkflowDefinition = {
    ...def,
    title: "Accidente",
    questions: def.questions.map((q) => ({ ...q, label: `ES ${q.id}`, help: undefined, options: q.options?.map((o) => ({ value: o.value, label: `ES ${o.value}` })) })),
  };
  const d = loadDraft(storage, translated, acc.scenario)!;
  assert.deepEqual(visibleAnswers(translated, d.answers), acc.answers);
  assert.deepEqual(shape(generateChecklist(translated, visibleAnswers(translated, d.answers), org)), shape(generateChecklist(def, acc.answers, org)));
  assert.equal(summarizeAnswers(translated, d.answers).find((r) => r.id === "driverCited")!.display, "ES NO", "only the display text follows the language");
  assert.equal(summarizeAnswers(def, d.answers).find((r) => r.id === "injuryTreatedAway")!.display, "Yes");
});

// ───────────────────────── Incomplete questionnaires ─────────────────────────

test("incomplete: only the unanswered question is asked; answered ones are kept and nothing is guessed", () => {
  const acc = CASES[0];
  const def = WORKFLOWS[acc.key];
  const storage = memoryStorage();
  const { driverCited: _omit, ...partial } = acc.answers;
  fillDraft(storage, acc.key, acc.scenario, partial, false);
  const d = loadDraft(storage, def, acc.scenario)!;
  assert.deepEqual(missingQuestions(def, d.answers).map((m) => m.question.id), ["driverCited"]);
  assert.equal(d.answers.driverCited, undefined, "the missing answer is not filled in for the user");
  assert.throws(() => generateChecklist(def, visibleAnswers(def, d.answers), org), ValidationError, "no checklist is built on a guess");
  assert.equal(Object.keys(d.answers).length, Object.keys(partial).length, "answers already given are preserved");

  // Answering it completes the set — the other seven are never asked again.
  const done = setDraftAnswer(d, "driverCited", "PENDING");
  assert.deepEqual(missingQuestions(def, done.answers), []);
  // "Not yet known" is carried as uncertainty, not as a yes or a no.
  const c = generateChecklist(def, visibleAnswers(def, done.answers), org);
  assert.ok(c.items.some((i) => i.classification === "UNABLE_TO_DETERMINE"), "uncertainty about a citation is shown as undetermined");
});

test("incomplete: an answer that reveals a follow-up asks only the follow-up", () => {
  const acc = CASES[0];
  const def = WORKFLOWS[acc.key];
  const a: Answers = { ...acc.answers, hazmatInvolved: true };
  assert.deepEqual(missingQuestions(def, a).map((m) => m.question.id), ["hazmatReleased"]);
  assert.deepEqual(missingQuestions(def, { ...a, hazmatReleased: true }).map((m) => m.question.id), ["nrcTrigger"]);
  assert.deepEqual(missingQuestions(def, { ...a, hazmatReleased: false }), []);
  // An optional question left blank is not "missing".
  const audit = CASES[4];
  const { noticeReceivedAt: _d, ...undated } = audit.answers;
  assert.deepEqual(missingQuestions(WORKFLOWS[audit.key], undated), []);
  assert.equal(summarizeAnswers(WORKFLOWS[audit.key], undated).find((r) => r.id === "noticeReceivedAt")!.display, "Not provided");
});

test("stored answers are validated before use: unknown questions, bad values, other workflows and stale drafts are not trusted", () => {
  const def = WORKFLOWS.DOT_ACCIDENT_RESPONSE;
  const clean = sanitizeAnswers(def, { fatality: "yes", injuryTreatedAway: true, driverCited: "MAYBE", accidentState: "ZZ", accidentAt: "not a date", madeUp: true, towAway: false });
  assert.deepEqual(clean, { injuryTreatedAway: true, towAway: false });
  assert.deepEqual(missingQuestions(def, clean).map((m) => m.question.id).sort(), ["accidentAt", "accidentState", "driverCited", "fatality", "hazmatInvolved", "onlyBoardingOrCargo"].sort());

  const storage = memoryStorage();
  const d = fillDraft(storage, "DOT_ACCIDENT_RESPONSE", 26, CASES[0].answers);
  const json = storage.map.get(draftKey("DOT_ACCIDENT_RESPONSE", 26))!;
  assert.equal(parseDraft(WORKFLOWS.AUDIT_NOTICE, 26, json), null, "another workflow's answers are never applied");
  assert.equal(parseDraft(def, 31, json), null, "another scenario's answers are never applied");
  assert.equal(parseDraft(def, 26, "{broken"), null);
  assert.equal(parseDraft(def, 26, JSON.stringify({ ...d, v: 99 })), null);
  const later = new Date(Date.now() + (DRAFT_MAX_AGE_DAYS + 1) * 86_400_000);
  assert.equal(parseDraft(def, 26, json, later), null, "old answers are not applied to a new incident");
  assert.ok(parseDraft(def, 26, json));
});

test("two scenarios of the same workflow keep separate answers; clearing one leaves the other", () => {
  const def = WORKFLOWS.VEHICLE_MAINTENANCE;
  const storage = memoryStorage();
  fillDraft(storage, "VEHICLE_MAINTENANCE", 36, CASES[1].answers);
  fillDraft(storage, "VEHICLE_MAINTENANCE", 35, CASES[3].answers);
  assert.equal(loadDraft(storage, def, 36)!.answers.situation, "DEFECT_REPORTED");
  assert.equal(loadDraft(storage, def, 35)!.answers.situation, "ANNUAL_EXPIRED");
  clearDraft(storage, "VEHICLE_MAINTENANCE", 36);
  assert.equal(loadDraft(storage, def, 36), null);
  assert.ok(loadDraft(storage, def, 35));
});

test("defective brakes: the safety answer drives the checklist the same way before and after transfer", () => {
  const def = WORKFLOWS.VEHICLE_MAINTENANCE;
  const blockers = (a: Answers) => generateChecklist(def, a, org).items.filter((i) => i.classification !== "NOT_APPLICABLE" && i.ruleSnapshot.prohibits).map((i) => i.ruleId).sort();
  const storage = memoryStorage();
  for (const v of ["YES", "NO", "UNKNOWN"]) {
    const answers = { ...CASES[1].answers, defectAffectsSafety: v };
    fillDraft(storage, "VEHICLE_MAINTENANCE", 36, answers);
    const carried = visibleAnswers(def, loadDraft(storage, def, 36)!.answers);
    assert.deepEqual(blockers(carried), blockers(answers), `defectAffectsSafety=${v}`);
  }
  assert.notDeepEqual(shape(generateChecklist(def, { ...CASES[1].answers, defectAffectsSafety: "NO" }, org)), shape(generateChecklist(def, CASES[1].answers, org)));
});

test("the save hand-off marker brings the visitor back to the right workflow and expires", () => {
  const storage = memoryStorage();
  assert.equal(getPendingSave(storage), null);
  setPendingSave(storage, { workflowKey: "AUDIT_NOTICE", scenario: 49, title: "DOT audit notice received" });
  assert.deepEqual({ ...getPendingSave(storage)!, at: undefined }, { workflowKey: "AUDIT_NOTICE", scenario: 49, title: "DOT audit notice received", at: undefined });
  assert.equal(getPendingSave(storage, new Date(Date.now() + 2 * 86_400_000)), null);
});

test("company and vehicle workflows do not demand a driver; driver workflows still do", () => {
  for (const k of ["NEW_CARRIER_STARTUP", "AUDIT_NOTICE", "VEHICLE_MAINTENANCE", "LEASED_EQUIPMENT", "STATE_EXPANSION"] as WorkflowKey[]) assert.equal(WORKFLOWS[k].driver, "optional", k);
  assert.equal(WORKFLOWS.HIRE_CDL_DRIVER.driver, "create");
  assert.equal(WORKFLOWS.DOT_ACCIDENT_RESPONSE.driver, "existing");
});

// ───────────────────────── Editing answers on a saved checklist ─────────────────────────

const OWNER = { id: "user_owner", role: "OWNER" as const };

/** Save a checklist the way createRun does, into the in-memory tenant store. */
async function savedRun(r: TenantRepository, key: WorkflowKey, answers: Answers, status = "ACTIVE") {
  const c = generateChecklist(WORKFLOWS[key], answers, org);
  const run = await r.create("workflowRun", { workflowKey: key, title: WORKFLOWS[key].title, answers, facts: c.facts, warnings: c.warnings, catalogVersion: c.catalogVersion, status, createdById: OWNER.id });
  for (const it of c.items) await r.create("checklistItem", { runId: run.id, ...it, naReason: null });
  return run.id as string;
}
const itemsOf = (r: TenantRepository, runId: string) => r.list<any>("checklistItem", { runId });
const byRule = async (r: TenantRepository, runId: string, ruleId: string) => (await itemsOf(r, runId)).find((i) => i.ruleId === ruleId);
const review = (rows: any[]) =>
  summarizeRun(rows.map((i) => ({ id: i.id, title: i.title, classification: i.classification, status: i.status, blocksSafetySensitive: i.blocksSafetySensitive, dueAt: i.dueAt, verificationStatus: i.ruleSnapshot.verificationStatus, evidenceCount: 0 })));

const ACCIDENT = CASES[0].answers;
const NOT_AN_ACCIDENT: Answers = { ...ACCIDENT, injuryTreatedAway: false, towAway: false };

test("edit answers: the checklist is re-evaluated, completed work and history are kept, and the user is warned", async () => {
  const db = createMemoryDb();
  const r = new TenantRepository("org_A", db);
  const runId = await savedRun(r, "DOT_ACCIDENT_RESPONSE", ACCIDENT);
  const before = await itemsOf(r, runId);
  const conditional = before.filter((i) => i.classification === "CONDITIONALLY_REQUIRED");
  assert.ok(conditional.length >= 2, "the accident checklist has steps that depend on the answers");
  const [doneItem, untouched] = conditional;
  await r.update("checklistItem", doneItem.id, { status: "COMPLETED", verifiedById: "user_sm", completionDate: "2026-10-09", notes: "Done and filed" });
  await r.create("itemEvent", { itemId: doneItem.id, actorId: "user_sm", kind: "STATUS", fromStatus: "PENDING_VERIFICATION", toStatus: "COMPLETED" });
  const progressBefore = review(await itemsOf(r, runId));

  // Preview first: nothing is written.
  const preview = await reviseRun(r, OWNER, runId, NOT_AN_ACCIDENT, org, { dryRun: true });
  assert.deepEqual((await r.find("workflowRun", runId)).answers, ACCIDENT);
  assert.equal(db._rows.auditLog.length, 0);
  assert.ok(preview.affectsRecordedWork.some((x) => x.id === doneItem.id), "the completed step is called out before saving");
  assert.deepEqual(preview.answerChanges.map((c) => c.questionId).sort(), ["injuryTreatedAway", "towAway"]);

  const plan = await reviseRun(r, OWNER, runId, NOT_AN_ACCIDENT, org);
  const run = await r.find("workflowRun", runId);
  assert.deepEqual(run.answers, NOT_AN_ACCIDENT, "the run holds the one current copy of the answers");
  assert.equal(run.facts.dotAccident, false);

  const done = await byRule(r, runId, doneItem.ruleId);
  assert.equal(done.status, "COMPLETED", "a completed step is not silently erased");
  assert.equal(done.classification, "NOT_APPLICABLE");
  assert.equal(done.notes, "Done and filed");
  assert.equal(done.verifiedById, "user_sm");
  assert.equal(done.blocksSafetySensitive, false);

  const other = await byRule(r, runId, untouched.ruleId);
  assert.equal(other.classification, "NOT_APPLICABLE");
  assert.equal(other.status, "NOT_APPLICABLE", "a step nobody had started simply drops out");

  // History: the earlier event is still there and the change is recorded on each touched step.
  const events = db._rows.itemEvent.filter((e: any) => e.itemId === doneItem.id);
  assert.deepEqual(events.map((e: any) => e.kind), ["STATUS", "ANSWERS"]);
  assert.match(events[1].note, /no longer applies.*kept/);
  assert.equal(db._rows.itemEvent.filter((e: any) => e.kind === "ANSWERS").length, plan.revisions.length);
  const audit = db._rows.auditLog.find((a: any) => a.action === "run.answers.update");
  assert.deepEqual(audit.meta.previousAnswers, ACCIDENT, "the original answers are preserved in the audit record");
  assert.equal(audit.meta.changes.length, 2);
  assert.equal(audit.actorId, OWNER.id);

  // Progress is recalculated from the new set of required steps.
  const progressAfter = review(await itemsOf(r, runId));
  assert.ok(progressAfter.mustResolve < progressBefore.mustResolve);
  assert.equal((await itemsOf(r, runId)).length, before.length, "no step row was deleted");

  // Changing the answer back makes the steps required again, without disturbing the completed one.
  const back = await reviseRun(r, OWNER, runId, ACCIDENT, org);
  assert.ok(back.revisions.some((x) => x.effect === "NOW_APPLIES"));
  assert.equal((await byRule(r, runId, untouched.ruleId)).status, "NOT_STARTED");
  assert.equal((await byRule(r, runId, untouched.ruleId)).classification, "CONDITIONALLY_REQUIRED");
  assert.equal((await byRule(r, runId, doneItem.ruleId)).status, "COMPLETED");
  assert.deepEqual(shape2(await itemsOf(r, runId)), shape2(before.map((i) => (i.id === doneItem.id ? { ...i, status: "COMPLETED" } : i))), "round trip restores the original evaluation");
});
const shape2 = (rows: any[]) => rows.map((i) => [i.ruleId, i.classification, i.status]).sort();

test("edit answers: invalid or incomplete answers change nothing; approved checklists are locked", async () => {
  const db = createMemoryDb();
  const r = new TenantRepository("org_A", db);
  const runId = await savedRun(r, "DOT_ACCIDENT_RESPONSE", ACCIDENT);
  const snapshot = JSON.stringify(db._rows);
  await assert.rejects(reviseRun(r, OWNER, runId, { ...ACCIDENT, driverCited: undefined }, org), ValidationError);
  await assert.rejects(reviseRun(r, OWNER, runId, { ...ACCIDENT, accidentState: "ZZ" }, org), ValidationError);
  assert.equal(JSON.stringify(db._rows), snapshot);

  // Saving the same answers is a no-op with no audit noise.
  await reviseRun(r, OWNER, runId, ACCIDENT, org);
  assert.equal(JSON.stringify(db._rows), snapshot);

  const approved = await savedRun(r, "DOT_ACCIDENT_RESPONSE", ACCIDENT, "APPROVED");
  await assert.rejects(reviseRun(r, OWNER, approved, NOT_AN_ACCIDENT, org), RevisionError);
});

test("edit answers: another organization cannot read or change the answers, and read-only roles cannot edit", async () => {
  const db = createMemoryDb();
  const a = new TenantRepository("org_A", db);
  const b = new TenantRepository("org_B", db);
  const runId = await savedRun(a, "DOT_ACCIDENT_RESPONSE", ACCIDENT);
  await assert.rejects(reviseRun(b, OWNER, runId, NOT_AN_ACCIDENT, org, { dryRun: true }), NotFoundError, "not even a preview leaks across organizations");
  await assert.rejects(reviseRun(b, OWNER, runId, NOT_AN_ACCIDENT, org), NotFoundError);
  await assert.rejects(b.find("workflowRun", runId), NotFoundError);
  for (const role of ["VIEWER", "DISPATCH"] as const) await assert.rejects(reviseRun(a, { id: "u", role }, runId, NOT_AN_ACCIDENT, org), ForbiddenError);
  assert.deepEqual((await a.find("workflowRun", runId)).answers, ACCIDENT);
  assert.equal(db._rows.auditLog.length, 0);
});

test("edit answers: deadlines follow a corrected date, but an internal deadline someone set is left alone", async () => {
  const db = createMemoryDb();
  const r = new TenantRepository("org_A", db);
  const runId = await savedRun(r, "DOT_ACCIDENT_RESPONSE", ACCIDENT);
  const dated = (await itemsOf(r, runId)).filter((i) => i.dueAt && i.classification !== "NOT_APPLICABLE");
  assert.ok(dated.length >= 1, "the accident checklist has computed deadlines");
  const target = dated[0];
  const offset = new Date(target.dueAt).getTime() - new Date(String(ACCIDENT.accidentAt)).getTime();

  // Unrelated answer changes, with a manual internal deadline in place → the manual date stays.
  const manual = new Date("2026-10-20T23:59:00.000Z");
  await r.update("checklistItem", target.id, { dueAt: manual });
  await reviseRun(r, OWNER, runId, { ...ACCIDENT, accidentState: "NV" }, org);
  assert.equal(new Date((await byRule(r, runId, target.ruleId)).dueAt).toISOString(), manual.toISOString());

  // The accident time itself is corrected → the regulatory date is recalculated from it.
  const corrected = "2026-10-08T16:30:00.000Z";
  const plan = await reviseRun(r, OWNER, runId, { ...ACCIDENT, accidentState: "NV", accidentAt: corrected }, org);
  assert.ok(plan.revisions.some((x) => x.ruleId === target.ruleId && x.effect === "DEADLINE_CHANGED"));
  assert.equal(new Date((await byRule(r, runId, target.ruleId)).dueAt).getTime(), new Date(corrected).getTime() + offset);
  assert.equal((await r.find("workflowRun", runId)).answers.accidentAt, corrected, "the date-time is stored exactly as entered");
});

test("edit answers: a workflow that changed after saving never rewrites existing steps; new requirements are added for review", () => {
  const def = WORKFLOWS.DOT_ACCIDENT_RESPONSE;
  const original = generateChecklist(def, ACCIDENT, org);
  const existing: ExistingItem[] = original.items.map((i, n) => ({
    id: `item_${n}`, ruleId: i.ruleId, ruleSnapshot: i.ruleSnapshot, title: i.title, stage: i.stage, classification: i.classification,
    blocksSafetySensitive: i.blocksSafetySensitive, status: n === 0 ? "COMPLETED" : i.status, dueAt: i.dueAt, naReason: null, sortOrder: i.sortOrder,
  }));
  // A later catalog: one existing rule reworded to never apply, and one brand-new rule.
  const current = rulesFor("DOT_ACCIDENT_RESPONSE");
  const reworded: RegulatoryRule = { ...current[0], version: current[0].version + 1, title: "REWORDED", appliesWhen: { fact: "fatality", isTrue: true } };
  const added: RegulatoryRule = { ...current[0], id: "TEST-NEW-REQUIREMENT", title: "New requirement", appliesWhen: { always: true } };
  const plan = planRevision(def, ACCIDENT, original.facts, { ...ACCIDENT, accidentState: "NV" }, org, existing, { catalog: [reworded, ...current.slice(1), added], catalogVersion: "9999.1" });

  assert.equal(plan.revisions.find((x) => x.ruleId === current[0].id), undefined, "the saved step keeps the rule text it was created with");
  assert.ok(!plan.revisions.some((x) => x.patch && "ruleSnapshot" in x.patch), "no revision replaces a rule snapshot");
  assert.deepEqual(plan.additions.map((x) => x.ruleId), ["TEST-NEW-REQUIREMENT"]);
  assert.equal(plan.additions[0].status, "NOT_STARTED");
  assert.match(plan.additions[0].reasons[0], /was not in the catalog when the checklist was created/);
  assert.ok(plan.additions[0].sortOrder > Math.max(...existing.map((e) => e.sortOrder)), "added after the existing steps, which keep their order");
});

test("edit answers: a step a person marked not applicable with a reason stays theirs", () => {
  const def = WORKFLOWS.DOT_ACCIDENT_RESPONSE;
  const start = generateChecklist(def, NOT_AN_ACCIDENT, org);
  const flips = generateChecklist(def, ACCIDENT, org).items.filter((i) => i.classification !== "NOT_APPLICABLE").map((i) => i.ruleId);
  const existing: ExistingItem[] = start.items.map((i, n) => ({
    id: `item_${n}`, ruleId: i.ruleId, ruleSnapshot: i.ruleSnapshot, title: i.title, stage: i.stage, classification: i.classification,
    blocksSafetySensitive: i.blocksSafetySensitive, status: i.status, dueAt: i.dueAt, naReason: null, sortOrder: i.sortOrder,
  }));
  const always = existing.find((e) => e.classification !== "NOT_APPLICABLE" && flips.includes(e.ruleId))!;
  always.status = "NOT_APPLICABLE";
  always.naReason = "Handled under the parent company's programme";
  const plan = planRevision(def, NOT_AN_ACCIDENT, start.facts, ACCIDENT, org, existing);
  assert.ok(plan.revisions.some((x) => x.effect === "NOW_APPLIES" && x.to.status === "NOT_STARTED"), "engine-set not-applicable steps come back");
  assert.ok(!plan.revisions.some((x) => x.id === always.id && x.to.status !== "NOT_APPLICABLE"), "a human override is not undone by an answer change");
});
