import type { WorkflowKey } from "../rules/types";
import { visibleQuestions, type Answers, type Question, type WorkflowDefinition } from "./definitions";

/**
 * The one record of a visitor's questionnaire answers.
 *
 * The public guide writes it as questions are answered; the "save as tracked checklist" page
 * reads the same record instead of asking again. Once a checklist is saved, the answers live on
 * the WorkflowRun row and this draft is cleared — there is never a second, unrelated copy.
 *
 * Answers are stored by stable question id with language-independent values (booleans, option
 * values, ISO dates) — never the text shown on screen — so wording or language can change
 * without losing them.
 *
 * Framework-free: the storage is passed in, so this runs in the browser and in tests.
 */

/** Guide-only question (signed-in checklists read this from the company profile). */
export const ALCOHOL_POLICY_ID = "_companyAlcoholPolicy";
const EXTRA_BOOLEAN_IDS = [ALCOHOL_POLICY_ID];

export const DRAFT_VERSION = 1;
/** Drafts older than this are ignored, so an old incident's answers are not applied to a new one. */
export const DRAFT_MAX_AGE_DAYS = 30;
const PENDING_KEY = "fleetcomply:pending-save";

export interface AnswerDraft {
  v: typeof DRAFT_VERSION;
  workflowKey: WorkflowKey;
  /** Scenario number the questionnaire was opened from, or null when opened by workflow. */
  scenario: number | null;
  /** Random id for this questionnaire session (not a user id; nothing personal). */
  sessionId: string;
  answers: Record<string, string | boolean>;
  /** ISO timestamp of the last change to each answer. */
  answeredAt: Record<string, string>;
  /** The visitor has pressed "Build my checklist" with these answers. */
  built: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function draftKey(workflowKey: WorkflowKey, scenario: number | null): string {
  return `fleetcomply:answers:${workflowKey}:${scenario ?? "any"}`;
}

function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDraft(workflowKey: WorkflowKey, scenario: number | null, now = new Date()): AnswerDraft {
  const at = now.toISOString();
  return { v: DRAFT_VERSION, workflowKey, scenario, sessionId: newSessionId(), answers: {}, answeredAt: {}, built: false, createdAt: at, updatedAt: at };
}

/** Record one answer. `undefined` or "" clears it. Returns a new draft. */
export function setDraftAnswer(draft: AnswerDraft, id: string, value: string | boolean | undefined, now = new Date()): AnswerDraft {
  const at = now.toISOString();
  const answers = { ...draft.answers };
  const answeredAt = { ...draft.answeredAt };
  if (value === undefined || value === "") {
    delete answers[id];
    delete answeredAt[id];
  } else {
    if (answers[id] !== value) answeredAt[id] = at;
    answers[id] = value;
  }
  return { ...draft, answers, answeredAt, updatedAt: at };
}

function validValue(q: Question, v: unknown): v is string | boolean {
  if (q.type === "boolean") return typeof v === "boolean";
  if (typeof v !== "string" || v === "") return false;
  if (q.type === "select" || q.type === "state") return !!q.options?.some((o) => o.value === v);
  if (q.type === "date" || q.type === "datetime") return !Number.isNaN(new Date(v).getTime());
  return true;
}

/**
 * Keep only answers that belong to a question of this workflow and have a value that question
 * accepts. Anything else (a renamed question, a removed option, tampered storage) is dropped so
 * it is asked again rather than trusted.
 */
export function sanitizeAnswers(def: WorkflowDefinition, raw: unknown): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const q of def.questions) {
    const v = src[q.id];
    if (validValue(q, v)) out[q.id] = v;
  }
  for (const id of EXTRA_BOOLEAN_IDS) if (typeof src[id] === "boolean") out[id] = src[id] as boolean;
  return out;
}

/** Parse a stored draft. Returns null when it is missing, malformed, for another workflow, or too old. */
export function parseDraft(def: WorkflowDefinition, scenario: number | null, json: string | null, now = new Date()): AnswerDraft | null {
  if (!json) return null;
  let d: Partial<AnswerDraft>;
  try {
    d = JSON.parse(json);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || d.v !== DRAFT_VERSION || d.workflowKey !== def.key || (d.scenario ?? null) !== scenario) return null;
  const updated = new Date(String(d.updatedAt));
  if (Number.isNaN(updated.getTime()) || now.getTime() - updated.getTime() > DRAFT_MAX_AGE_DAYS * 86_400_000) return null;
  const answers = sanitizeAnswers(def, d.answers);
  const answeredAt: Record<string, string> = {};
  for (const id of Object.keys(answers)) {
    const at = (d.answeredAt as Record<string, unknown> | undefined)?.[id];
    answeredAt[id] = typeof at === "string" ? at : updated.toISOString();
  }
  return {
    v: DRAFT_VERSION,
    workflowKey: def.key,
    scenario,
    sessionId: typeof d.sessionId === "string" ? d.sessionId : newSessionId(),
    answers,
    answeredAt,
    built: d.built === true,
    createdAt: typeof d.createdAt === "string" ? d.createdAt : updated.toISOString(),
    updatedAt: updated.toISOString(),
  };
}

export function loadDraft(storage: StorageLike, def: WorkflowDefinition, scenario: number | null, now = new Date()): AnswerDraft | null {
  try {
    return parseDraft(def, scenario, storage.getItem(draftKey(def.key, scenario)), now);
  } catch {
    return null;
  }
}

export function saveDraft(storage: StorageLike, draft: AnswerDraft): void {
  try {
    storage.setItem(draftKey(draft.workflowKey, draft.scenario), JSON.stringify(draft));
  } catch {
    /* storage is optional — the questionnaire still works without it */
  }
}

export function clearDraft(storage: StorageLike, workflowKey: WorkflowKey, scenario: number | null): void {
  try {
    storage.removeItem(draftKey(workflowKey, scenario));
  } catch {
    /* ignore */
  }
}

/** Answers to the questions that are visible for these answers — what the checklist is built from. */
export function visibleAnswers(def: WorkflowDefinition, answers: Answers): Answers {
  return Object.fromEntries(visibleQuestions(def, answers).map((q) => [q.id, answers[q.id]]));
}

/**
 * The questions still needed before a checklist can be built: visible questions that fail the
 * workflow's own validation (unanswered and required, or inconsistent with another answer).
 * Answered questions are never in this list.
 */
export function missingQuestions(def: WorkflowDefinition, answers: Answers): Array<{ question: Question; message: string }> {
  const errors = def.validate(visibleAnswers(def, answers));
  return visibleQuestions(def, answers)
    .filter((q) => errors[q.id])
    .map((q) => ({ question: q, message: errors[q.id] }));
}

export function isComplete(def: WorkflowDefinition, answers: Answers): boolean {
  return Object.keys(def.validate(visibleAnswers(def, answers))).length === 0;
}

export interface AnswerSummaryRow {
  id: string;
  label: string;
  type: Question["type"];
  /** Stored value (language-independent). */
  value: string | boolean | undefined;
  /** Text to show. Date-times are left as ISO for the caller to format in the viewer's time zone. */
  display: string;
  answered: boolean;
}

/** One row per visible question, in questionnaire order, for the "Your Scenario Details" panel. */
export function summarizeAnswers(def: WorkflowDefinition, answers: Answers): AnswerSummaryRow[] {
  return visibleQuestions(def, answers).map((q) => {
    const value = answers[q.id];
    const answered = value !== undefined && value !== "";
    let display = "Not provided";
    if (answered) {
      if (typeof value === "boolean") display = value ? "Yes" : "No";
      else if (q.type === "select" || q.type === "state") display = q.options?.find((o) => o.value === value)?.label ?? String(value);
      else display = String(value);
    }
    return { id: q.id, label: q.label, type: q.type, value, display, answered };
  });
}

// ───────────── "Save as tracked checklist" hand-off marker ─────────────

export interface PendingSave {
  workflowKey: WorkflowKey;
  scenario: number | null;
  title: string;
  at: string;
}

/** Remember that the visitor asked to save this guide, so they can be brought back after signing in. */
export function setPendingSave(storage: StorageLike, p: Omit<PendingSave, "at">, now = new Date()): void {
  try {
    storage.setItem(PENDING_KEY, JSON.stringify({ ...p, at: now.toISOString() }));
  } catch {
    /* ignore */
  }
}

export function getPendingSave(storage: StorageLike, now = new Date()): PendingSave | null {
  try {
    const p = JSON.parse(storage.getItem(PENDING_KEY) ?? "null") as PendingSave | null;
    if (!p || typeof p.workflowKey !== "string" || typeof p.title !== "string") return null;
    const at = new Date(p.at);
    if (Number.isNaN(at.getTime()) || now.getTime() - at.getTime() > 86_400_000) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearPendingSave(storage: StorageLike): void {
  try {
    storage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}
