import { test } from "node:test";
import assert from "node:assert/strict";
import { transition, TransitionError, type ItemState } from "../src/lib/workflows/status";
import { summarizeRun, assertCanApprove, ApprovalError, readinessScore, type ReviewItem } from "../src/lib/workflows/review";

const hr = { id: "u-hr", role: "HR" as const };
const safety = { id: "u-safety", role: "SAFETY_MANAGER" as const };
const viewer = { id: "u-view", role: "VIEWER" as const };
const base: ItemState = { status: "NOT_STARTED", classification: "LEGALLY_REQUIRED", evidenceCount: 0 };

test("happy path: not started → in progress → pending verification → completed (by a different verifier)", () => {
  const a = transition(base, { to: "IN_PROGRESS" }, hr);
  assert.equal(a.patch.status, "IN_PROGRESS");
  const b = transition({ ...base, status: "IN_PROGRESS", evidenceCount: 1 }, { to: "PENDING_VERIFICATION" }, hr);
  assert.equal(b.patch.completedById, "u-hr");
  const c = transition({ ...base, status: "PENDING_VERIFICATION", evidenceCount: 1, completedById: "u-hr" }, { to: "COMPLETED" }, safety);
  assert.equal(c.patch.verifiedById, "u-safety");
  assert.equal(c.event.fromStatus, "PENDING_VERIFICATION");
  assert.equal(c.event.toStatus, "COMPLETED");
});

test("cannot skip straight to COMPLETED", () => {
  assert.throws(() => transition(base, { to: "COMPLETED" }, safety), TransitionError);
});

test("submitting for verification requires evidence or a dated note", () => {
  const ip = { ...base, status: "IN_PROGRESS" as const };
  assert.throws(() => transition(ip, { to: "PENDING_VERIFICATION" }, hr), /evidence/);
  const ok = transition(ip, { to: "PENDING_VERIFICATION", completionDate: "2026-10-08", reason: "Called prior employer, response filed" }, hr);
  assert.equal(ok.patch.completionDate, "2026-10-08");
});

test("only verifier roles can complete, and not the person who submitted", () => {
  const pending = { ...base, status: "PENDING_VERIFICATION" as const, evidenceCount: 1, completedById: "u-safety" };
  assert.throws(() => transition({ ...pending, completedById: "u-x" }, { to: "COMPLETED" }, hr), /Safety Manager/);
  assert.throws(() => transition(pending, { to: "COMPLETED" }, safety), /different person/);
  assert.doesNotThrow(() => transition(pending, { to: "COMPLETED" }, safety, { soleOwnerOrg: true }));
});

test("rejecting verification needs a reason", () => {
  const pending = { ...base, status: "PENDING_VERIFICATION" as const, evidenceCount: 1, completedById: "u-hr" };
  assert.throws(() => transition(pending, { to: "IN_PROGRESS" }, safety), /why verification was rejected/);
  assert.equal(transition(pending, { to: "IN_PROGRESS", reason: "Wrong MVR state" }, safety).event.note, "Wrong MVR state");
});

test("marking a required item N/A needs a reason and a verifier role, and is flagged", () => {
  assert.throws(() => transition(base, { to: "NOT_APPLICABLE" }, safety), /Explain/);
  assert.throws(() => transition(base, { to: "NOT_APPLICABLE", reason: "x" }, hr), /Only a Safety Manager/);
  const r = transition(base, { to: "NOT_APPLICABLE", reason: "Subpart G exception documented" }, safety);
  assert.equal(r.flags.length, 1);
  // Best-practice items can be marked N/A by any editor without a flag
  const bp = transition({ ...base, classification: "BEST_PRACTICE" }, { to: "NOT_APPLICABLE", reason: "Not used" }, hr);
  assert.equal(bp.flags.length, 0);
});

test("blocked items need a reason; reopening completed items needs a verifier and a reason", () => {
  assert.throws(() => transition(base, { to: "BLOCKED" }, hr), /blocking/);
  const done = { ...base, status: "COMPLETED" as const, evidenceCount: 1 };
  assert.throws(() => transition(done, { to: "IN_PROGRESS", reason: "x" }, hr), /verifier/);
  const re = transition(done, { to: "IN_PROGRESS", reason: "Document expired" }, safety);
  assert.equal(re.patch.verifiedById, null);
});

test("read-only users cannot change items", () => {
  assert.throws(() => transition(base, { to: "IN_PROGRESS" }, viewer), /role/);
});

// ───── Review / approval ─────

const item = (o: Partial<ReviewItem>): ReviewItem => ({
  id: Math.random().toString(36),
  title: "t",
  classification: "LEGALLY_REQUIRED",
  status: "NOT_STARTED",
  blocksSafetySensitive: false,
  dueAt: null,
  verificationStatus: "VERIFIED",
  evidenceCount: 0,
  ...o,
});

test("checked boxes are not enough: blockers pending verification keep the driver un-cleared", () => {
  const s = summarizeRun([
    item({ status: "PENDING_VERIFICATION", blocksSafetySensitive: true, evidenceCount: 1 }),
    item({ status: "COMPLETED", evidenceCount: 1 }),
  ]);
  assert.equal(s.safetySensitiveCleared, false);
  assert.equal(s.readyForReview, false);
});

test("undetermined items must be resolved before approval", () => {
  const s = summarizeRun([item({ classification: "UNABLE_TO_DETERMINE" }), item({ status: "COMPLETED", evidenceCount: 1 })]);
  assert.equal(s.readyForReview, false);
  assert.equal(s.undetermined.length, 1);
});

test("best-practice items do not block approval", () => {
  const s = summarizeRun([item({ status: "COMPLETED", evidenceCount: 1 }), item({ classification: "BEST_PRACTICE" })]);
  assert.equal(s.readyForReview, true);
});

test("approval requires role, readiness and a review note", () => {
  const ready = summarizeRun([item({ status: "COMPLETED", evidenceCount: 1 })]);
  assert.throws(() => assertCanApprove(ready, "HR", "ok"), ApprovalError);
  assert.throws(() => assertCanApprove(ready, "SAFETY_MANAGER", " "), ApprovalError);
  assert.doesNotThrow(() => assertCanApprove(ready, "SAFETY_MANAGER", "Reviewed DQ file"));
  const notReady = summarizeRun([item({})]);
  assert.throws(() => assertCanApprove(notReady, "OWNER", "x"), /not yet completed/);
});

test("report issues surface overdue, overrides and completion without documents", () => {
  const now = new Date("2026-10-08T00:00:00Z");
  const s = summarizeRun(
    [
      item({ dueAt: new Date("2026-10-01T00:00:00Z") }),
      item({ status: "NOT_APPLICABLE", overrideFlag: true }),
      item({ status: "COMPLETED", evidenceCount: 0 }),
    ],
    now,
  );
  assert.equal(s.overdue.length, 1);
  assert.equal(s.overrides.length, 1);
  assert.equal(s.completedWithoutDocuments.length, 1);
  assert.ok(s.issues.length >= 3);
});

test("readiness score is explained and penalizes overdue items and blockers", () => {
  const now = new Date("2026-10-08T00:00:00Z");
  const r = readinessScore(
    [item({ status: "COMPLETED", evidenceCount: 1 }), item({ blocksSafetySensitive: true, dueAt: new Date("2026-10-01") })],
    now,
  );
  assert.equal(r.score, 35); // 50 − 5 − 10
  assert.equal(r.explanation.length, 3);
  assert.match(r.disclaimer, /not a measure or guarantee/);
});
