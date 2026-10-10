import type { Classification } from "../rules/types";
import type { Role } from "../auth/rbac";
import { can } from "../auth/rbac";

export type ItemStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "PENDING_VERIFICATION"
  | "COMPLETED"
  | "NOT_APPLICABLE"
  | "BLOCKED";

export const STATUS_LABEL: Record<ItemStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  PENDING_VERIFICATION: "Pending verification",
  COMPLETED: "Completed",
  NOT_APPLICABLE: "Not applicable",
  BLOCKED: "Blocked",
};

export interface ItemState {
  status: ItemStatus;
  classification: Classification;
  completedById?: string | null;
  completionDate?: string | null;
  evidenceCount: number; // linked documents
  notes?: string | null;
}

export interface Actor {
  id: string;
  role: Role;
}

export interface TransitionRequest {
  to: ItemStatus;
  /** Required for NOT_APPLICABLE, BLOCKED, rejecting verification, and reopening. */
  reason?: string;
  completionDate?: string;
}

export interface TransitionResult {
  patch: Partial<{
    status: ItemStatus;
    completedById: string | null;
    completionDate: string | null;
    verifiedById: string | null;
    verifiedAt: Date | null;
    naReason: string | null;
    blockedReason: string | null;
  }>;
  event: { fromStatus: ItemStatus; toStatus: ItemStatus; actorId: string; note: string | null; at: Date };
  /** Flags surfaced on the final report. */
  flags: string[];
}

export class TransitionError extends Error {}

const ALLOWED: Record<ItemStatus, ItemStatus[]> = {
  NOT_STARTED: ["IN_PROGRESS", "NOT_APPLICABLE", "BLOCKED"],
  IN_PROGRESS: ["PENDING_VERIFICATION", "BLOCKED", "NOT_STARTED", "NOT_APPLICABLE"],
  PENDING_VERIFICATION: ["COMPLETED", "IN_PROGRESS"],
  BLOCKED: ["IN_PROGRESS", "NOT_STARTED"],
  COMPLETED: ["IN_PROGRESS"],
  NOT_APPLICABLE: ["NOT_STARTED"],
};

export function allowedTransitions(from: ItemStatus): ItemStatus[] {
  return ALLOWED[from];
}

/** Checked on the checklist = submitted as done (awaiting verification) or verified complete. */
export function isCheckedOff(status: ItemStatus): boolean {
  return status === "PENDING_VERIFICATION" || status === "COMPLETED";
}

export const CHECKED_NOTE = "Checked off on the checklist";
export const UNCHECKED_NOTE = "Unchecked on the checklist";

/**
 * The checkbox on a saved checklist is a shortcut through the normal status steps — it adds no
 * new rules. Checking submits the step as done with today's date (it still needs verification
 * like any other submission); unchecking sends it back to "in progress". Each request returned
 * here goes through `transition`, so roles, evidence and segregation of duties apply unchanged
 * and every step is written to the history.
 */
export function checkboxRequests(from: ItemStatus, checked: boolean, today: string): TransitionRequest[] {
  if (from === "NOT_APPLICABLE") throw new TransitionError("This step is marked not applicable. Reset it first if it does apply.");
  if (checked) {
    if (isCheckedOff(from)) return [];
    const submit: TransitionRequest = { to: "PENDING_VERIFICATION", reason: CHECKED_NOTE, completionDate: today };
    return from === "IN_PROGRESS" ? [submit] : [{ to: "IN_PROGRESS" }, submit];
  }
  return isCheckedOff(from) ? [{ to: "IN_PROGRESS", reason: UNCHECKED_NOTE }] : [];
}

const REQUIRED_CLASSES: Classification[] = ["LEGALLY_REQUIRED", "CONDITIONALLY_REQUIRED", "COMPANY_POLICY"];

/**
 * The single place status rules live. Throws TransitionError with a
 * user-facing message when a change is not allowed.
 *
 * Key rules:
 *  - Submitting for verification needs evidence: a linked document, or a completion date + note.
 *  - Only a verifier role may mark COMPLETED, and not the same person who submitted it
 *    (segregation of duties) unless the org has a single user with OWNER role.
 *  - Marking a required item NOT_APPLICABLE needs a reason AND a verifier role; it is flagged on the report.
 */
export function transition(
  item: ItemState,
  req: TransitionRequest,
  actor: Actor,
  opts: { now?: Date; soleOwnerOrg?: boolean } = {},
): TransitionResult {
  const now = opts.now ?? new Date();
  const from = item.status;
  const to = req.to;
  const reason = req.reason?.trim() || null;
  const flags: string[] = [];

  if (!can(actor.role, "item:update")) throw new TransitionError("Your role cannot change checklist items.");
  if (from === to) throw new TransitionError(`Item is already ${STATUS_LABEL[to]}.`);
  if (!ALLOWED[from].includes(to))
    throw new TransitionError(`Cannot move from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}.`);

  const patch: TransitionResult["patch"] = { status: to };

  switch (to) {
    case "PENDING_VERIFICATION": {
      const date = req.completionDate ?? item.completionDate;
      const hasNote = !!(reason || item.notes?.trim());
      if (item.evidenceCount === 0 && !(date && hasNote))
        throw new TransitionError("Attach supporting evidence, or record a completion date and a note describing what was done.");
      patch.completedById = actor.id;
      patch.completionDate = date ?? null;
      break;
    }
    case "COMPLETED": {
      if (!can(actor.role, "item:verify")) throw new TransitionError("Only a Safety Manager, Admin or Owner can verify an item.");
      if (item.completedById === actor.id && !opts.soleOwnerOrg)
        throw new TransitionError("A different person must verify an item than the one who submitted it.");
      patch.verifiedById = actor.id;
      patch.verifiedAt = now;
      break;
    }
    case "NOT_APPLICABLE": {
      if (!reason) throw new TransitionError("Explain why this item does not apply.");
      if (REQUIRED_CLASSES.includes(item.classification) || item.classification === "UNABLE_TO_DETERMINE") {
        if (!can(actor.role, "item:verify"))
          throw new TransitionError("Only a Safety Manager, Admin or Owner can mark a required item Not Applicable.");
        flags.push("Required item marked Not Applicable by user override — review the stated reason.");
      }
      patch.naReason = reason;
      break;
    }
    case "BLOCKED": {
      if (!reason) throw new TransitionError("Describe what is blocking this item.");
      patch.blockedReason = reason;
      break;
    }
    case "IN_PROGRESS": {
      if (from === "PENDING_VERIFICATION" && !reason) throw new TransitionError("Explain why verification was rejected.");
      if (from === "COMPLETED") {
        if (!can(actor.role, "item:verify")) throw new TransitionError("Only a verifier role can reopen a completed item.");
        if (!reason) throw new TransitionError("Explain why the item is being reopened.");
        patch.verifiedById = null;
        patch.verifiedAt = null;
      }
      if (from === "BLOCKED") patch.blockedReason = null;
      break;
    }
    case "NOT_STARTED": {
      if (from === "NOT_APPLICABLE") patch.naReason = null;
      if (from === "BLOCKED") patch.blockedReason = null;
      break;
    }
  }

  return { patch, event: { fromStatus: from, toStatus: to, actorId: actor.id, note: reason, at: now }, flags };
}
