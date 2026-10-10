import type { Classification, RegulatoryRule } from "./types";

/**
 * Two separate questions, never merged:
 *
 *   1. CONTENT REVIEW — has the guidance itself (wording and citations) been reviewed by an
 *      administrator? Read from the rule version being shown.
 *   2. APPLICABILITY — do this customer's answers establish that the step (or an exemption)
 *      applies to them? Decided by the rules engine from the questionnaire.
 *
 * Reviewing the content never answers the second question, and neither is changed by ticking a
 * checkbox. Framework-free so the public guide, saved checklists and tests share it.
 */

export type ContentReviewState = "PENDING" | "REVIEWED" | "REVERIFY" | "REJECTED" | "NONE";

export interface ContentReview {
  state: ContentReviewState;
  /** Short label for a badge; empty for NONE. */
  label: string;
  /** One or two sentences explaining it. */
  detail: string;
  reviewedAt?: string;
}

export const CONTENT_REVIEW_LABELS = {
  pending: "Regulatory guidance pending review",
  reviewed: "Regulatory content reviewed",
  reverify: "Regulatory content reviewed — under re-review",
  rejected: "Guidance under correction",
} as const;

export function contentReview(rule: RegulatoryRule): ContentReview {
  if (rule.reviewNotice) return { state: "REJECTED", label: CONTENT_REVIEW_LABELS.rejected, detail: rule.reviewNotice };
  if (rule.humanReview) {
    const on = rule.humanReview.reviewedAt.slice(0, 10);
    return rule.humanReview.reverificationRequired
      ? { state: "REVERIFY", label: CONTENT_REVIEW_LABELS.reverify, reviewedAt: on, detail: `Reviewed on ${on}. A regulatory change affecting the cited sections has since been detected, so this guidance is being reviewed again. Check the official text before relying on it.` }
      : { state: "REVIEWED", label: CONTENT_REVIEW_LABELS.reviewed, reviewedAt: on, detail: `The wording and citations of this step were reviewed against the official sources on ${on}. This is a review of the guidance, not a finding that it applies to you or that you are in compliance.` };
  }
  if (rule.verificationStatus === "REQUIRES_VERIFICATION")
    return { state: "PENDING", label: CONTENT_REVIEW_LABELS.pending, detail: rule.verificationNote ?? "This step has not yet been reviewed against the official sources. Confirm it from the cited text before relying on it." };
  return { state: "NONE", label: "", detail: "" };
}

const EXEMPTION_WORDING = /\b(exempt(ion|ions|ed|s)?|exception|waiver|variance)\b/i;

/** The step's own text is about an exemption, exception, waiver or variance. */
export function concernsExemption(rule: Pick<RegulatoryRule, "title" | "requiredAction">): boolean {
  return EXEMPTION_WORDING.test(rule.title) || rule.requiredAction.some((a) => EXEMPTION_WORDING.test(a));
}

export interface ApplicabilityStatus {
  resolved: boolean;
  label: string;
  detail: string;
}

/** The customer-specific side. A content review never changes this. */
export function applicabilityStatus(rule: RegulatoryRule, classification: Classification): ApplicabilityStatus {
  if (classification === "UNABLE_TO_DETERMINE")
    return { resolved: false, label: "Applicability to you: not yet determined", detail: "Your answers do not establish whether this step applies. It stays open until that is decided." };
  if (classification === "NOT_APPLICABLE") return { resolved: true, label: "Applicability to you: does not apply on your answers", detail: "" };
  if (concernsExemption(rule))
    return {
      resolved: false,
      label: "Eligibility: not established by this checklist",
      detail: "Whether you or the driver qualify is decided from your own facts and records — check each condition of the section relied on and keep the supporting documents listed. A review of this guidance does not establish that you qualify.",
    };
  return { resolved: true, label: "Applicability to you: applies on your answers", detail: "" };
}
