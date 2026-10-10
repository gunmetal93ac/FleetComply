"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { isPlatformAdmin, PlatformAdminRequiredError } from "@/lib/auth/rbac";
import { SourceRequestError } from "@/lib/regulatory/http";
import { ecfrFetcher, prismaVerificationStore } from "@/lib/regulatory/verification-store";
import {
  assignReviewer,
  draftCitationRepair,
  monitorCoverage,
  publishCorrection,
  reviewFinding,
  recordDecision,
  runSourceCheck,
  saveProposedCorrection,
  VerificationError,
  type Actor,
  type Decision,
  type Disposition,
  type Wording,
} from "@/lib/regulatory/verification";

export type VerificationResult = { ok: true; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Minimum time between source checks of the same step — protects the official sources from repeated clicks. */
const MIN_CHECK_INTERVAL_MS = 60_000;

/**
 * Every action here is authorized on the server by the platform-administrator flag on the signed-in
 * account (set only by `npm.cmd run admin:grant`). Hiding a button is never relied on, and the
 * library functions check the same flag again.
 */
async function admin(): Promise<Actor | null> {
  const user = await getCurrentUser();
  return user && isPlatformAdmin(user) ? { id: user.id, orgId: user.orgId, platformAdmin: true } : null;
}

function fail(e: unknown): VerificationResult {
  if (e instanceof VerificationError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
  if (e instanceof PlatformAdminRequiredError) return { ok: false, error: "Not authorized." };
  if (e instanceof SourceRequestError) return { ok: false, error: `The official source could not be reached: ${e.message}` };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was changed." };
}

const refresh = (ruleId: string) => {
  revalidatePath("/admin/regulatory");
  revalidatePath(`/admin/regulatory/verification/${ruleId}`);
};

/** Retrieve the cited sections from the official eCFR. Read-only towards the source; stores evidence only. */
export async function checkSourcesAction(ruleId: string): Promise<VerificationResult> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "Not authorized." };
  try {
    const store = prismaVerificationStore(prisma);
    const last = (await store.getState(ruleId))?.lastSourceCheckAt;
    if (last && Date.now() - last.getTime() < MIN_CHECK_INTERVAL_MS) return { ok: false, error: "This step was checked less than a minute ago. Please wait before checking again." };
    const check = await runSourceCheck(store, ecfrFetcher(), actor, ruleId);
    refresh(ruleId);
    const got = check.sections.filter((s) => s.textHash).length;
    const summary = `${got} of ${check.sections.length} section${check.sections.length === 1 ? "" : "s"} retrieved from eCFR issue ${check.issueDate ?? "—"}; ${check.findings.filter((f) => f.severity !== "INFO").length} finding(s) to review.`;
    return check.outcome === "RETRIEVED" || check.outcome === "NOTHING_TO_RETRIEVE"
      ? { ok: true, message: check.outcome === "NOTHING_TO_RETRIEVE" ? "This step cites no CFR section that can be retrieved automatically. Open its official links and record what you relied on." : `${summary} This is evidence for your review — it is not an approval.` }
      : { ok: false, error: `${summary} The check was incomplete, so the step stays pending.` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveCorrectionAction(ruleId: string, wording: Wording): Promise<VerificationResult> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "Not authorized." };
  try {
    await saveProposedCorrection(prismaVerificationStore(prisma), actor, ruleId, wording);
    refresh(ruleId);
    return { ok: true, message: "Proposed correction saved. It is a draft: customers do not see it." };
  } catch (e) {
    return fail(e);
  }
}

export async function assignReviewerAction(ruleId: string, assigneeId: string | null): Promise<VerificationResult> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "Not authorized." };
  try {
    if (assigneeId) {
      const u = await prisma.user.findUnique({ where: { id: assigneeId }, select: { platformAdmin: true, disabled: true } });
      if (!u || !isPlatformAdmin(u)) return { ok: false, error: "Reviews can only be assigned to a platform administrator." };
    }
    await assignReviewer(prismaVerificationStore(prisma), actor, ruleId, assigneeId);
    refresh(ruleId);
    return { ok: true, message: assigneeId ? "Reviewer assigned." : "Reviewer cleared." };
  } catch (e) {
    return fail(e);
  }
}

export async function decideAction(ruleId: string, input: { decision: Decision; note: string; sources: string[]; confirmation?: string }): Promise<VerificationResult> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "Not authorized." };
  try {
    const { state } = await prisma.$transaction((tx) => recordDecision(prismaVerificationStore(tx), actor, ruleId, input));
    refresh(ruleId);
    return {
      ok: true,
      message:
        state.status === "APPROVED_AWAITING_PUBLICATION"
          ? "Approved — awaiting publication. Customers still see the current version until you publish."
          : "Decision recorded in the review history.",
    };
  } catch (e) {
    return fail(e);
  }
}

/** The separate, explicit publication step. Creates a new version of the step; nothing is overwritten. */
export async function publishCorrectionAction(ruleId: string, confirmation: string): Promise<VerificationResult> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "Not authorized." };
  try {
    const { published } = await prisma.$transaction((tx) => publishCorrection(prismaVerificationStore(tx), actor, ruleId, confirmation));
    refresh(ruleId);
    revalidatePath("/guide", "layout");
    return { ok: true, message: `Published as version ${published.version}. New checklists use it; saved checklists keep the version they were created with.` };
  } catch (e) {
    return fail(e);
  }
}

/** Record how a deterministic finding was handled. Bookkeeping only — it approves nothing. */
export async function reviewFindingAction(ruleId: string, key: string, disposition: Disposition, note: string): Promise<VerificationResult> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "Not authorized." };
  try {
    await reviewFinding(prismaVerificationStore(prisma), actor, ruleId, key, disposition, note);
    refresh(ruleId);
    return { ok: true, message: "Recorded in the finding's history and the audit log." };
  } catch (e) {
    return fail(e);
  }
}

/** Add active sections of a cited range, subpart or part to Regulatory Intelligence monitoring for this step. */
export async function monitorCoverageAction(ruleId: string, sections: string[]): Promise<VerificationResult> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "Not authorized." };
  try {
    const added = await prisma.$transaction((tx) => monitorCoverage(prismaVerificationStore(tx), actor, ruleId, sections));
    refresh(ruleId);
    return {
      ok: true,
      message: added.length
        ? `Now monitored for this step: § ${added.join(", § ")}. A baseline of each is stored the next time a monitoring check runs; changes are reported after that.`
        : "Those sections were already monitored.",
    };
  } catch (e) {
    return fail(e);
  }
}

/** Draft a citation-only repair (individual sections for ranges, corrected links). A draft: nothing is approved or published. */
export async function draftCitationRepairAction(ruleId: string): Promise<VerificationResult> {
  const actor = await admin();
  if (!actor) return { ok: false, error: "Not authorized." };
  try {
    const { changes } = await draftCitationRepair(prismaVerificationStore(prisma), actor, ruleId);
    refresh(ruleId);
    return { ok: true, message: `Draft updated — ${changes.join(" ")} Review it under Proposed Correction; customers do not see it.` };
  } catch (e) {
    return fail(e);
  }
}
