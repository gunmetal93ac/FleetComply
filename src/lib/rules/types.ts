/**
 * FleetComply regulatory rules engine — core types.
 *
 * This module is framework-free on purpose: it is imported by Next.js server
 * code, by the Prisma seed script, and by the automated test suite.
 */

/** How a requirement relates to the user's specific situation (output of the engine). */
export type Classification =
  | "LEGALLY_REQUIRED" // applies to every run of this workflow (unconditional legal duty)
  | "CONDITIONALLY_REQUIRED" // legal duty triggered by the user's answers
  | "BEST_PRACTICE" // recommended, not mandated by the cited source
  | "COMPANY_POLICY" // required only because the organization chose to require it
  | "NOT_APPLICABLE" // conditions not met for this situation
  | "UNABLE_TO_DETERMINE"; // missing facts, state rules not loaded, or claimed exemption

/** What kind of obligation a catalog entry represents (input to the engine). */
export type RuleKind = "LEGAL" | "BEST_PRACTICE" | "COMPANY_POLICY";

/**
 * Whether the rule text was checked against the official source for this
 * catalog release. REQUIRES_VERIFICATION items are shown with a warning badge
 * and can never be presented as verified requirements.
 */
export type VerificationStatus = "VERIFIED" | "REQUIRES_VERIFICATION";

/** Keeps HR/payroll obligations visibly separate from the FMCSA DQ file. */
export type RecordCategory =
  | "DRIVER_QUALIFICATION_FILE"
  | "DRIVER_INVESTIGATION_HISTORY_FILE"
  | "DRUG_ALCOHOL_PROGRAM"
  | "HAZMAT_TRAINING"
  | "ACCIDENT_RECORDS"
  | "GENERAL_EMPLOYMENT"
  | "COMPANY_RECORDS";

export type WorkflowKey =
  | "HIRE_CDL_DRIVER"
  | "DOT_ACCIDENT_RESPONSE"
  | "DRUG_ALCOHOL_VIOLATION"
  | "ROADSIDE_INSPECTION"
  | "HOS_VIOLATION"
  | "MEDICAL_CERT_EXPIRED"
  | "CDL_DISQUALIFIED"
  | "DRIVER_SEPARATION"
  | "SHORT_HAUL_STATUS"
  | "ELD_MALFUNCTION"
  | "DRIVER_CITATION"
  | "VEHICLE_MAINTENANCE"
  | "RANDOM_TEST_SELECTION"
  | "LEASED_EQUIPMENT"
  | "NEW_CARRIER_STARTUP"
  | "AUDIT_NOTICE"
  | "DRIVER_RELOCATION"
  | "STATE_EXPANSION";

export type FactValue = string | number | boolean | null | undefined;
export type Facts = Record<string, FactValue>;

/**
 * Declarative applicability conditions. Evaluated with three-valued logic:
 * a condition over a fact that is missing or "UNKNOWN" yields `unknown`,
 * which surfaces as UNABLE_TO_DETERMINE rather than a silent guess.
 */
export type Condition =
  | { always: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; eq: FactValue }
  | { fact: string; in: FactValue[] }
  | { fact: string; isTrue: true }
  | { fact: string; isFalse: true };

export interface RetentionRule {
  record: string;
  period: string;
  citation?: string;
}

export interface Deadline {
  /** Plain-language deadline shown to the user. */
  description: string;
  /** Fact holding an ISO date/time the deadline is measured from. */
  anchor?: "employmentStartDate" | "accidentAt" | "determinationAt" | "inspectionAt" | "noticeReceivedAt" | "malfunctionAt" | "domicileEstablishedOn";
  /** Offset from the anchor. */
  offsetHours?: number;
  offsetDays?: number;
  /**
   * "Close of the Nth business day". Weekends are skipped; federal holidays are
   * NOT yet modeled, so the computed date may be earlier than the legal
   * deadline (never later). The UI says so.
   */
  offsetBusinessDays?: number;
}

export interface SourceCitation {
  citation: string; // e.g. "49 CFR 391.23(a)(1)"
  url: string; // official source URL
}

export interface RuleChange {
  version: number;
  date: string; // ISO date
  note: string;
}

export interface RegulatoryRule {
  id: string;
  version: number;
  workflows: WorkflowKey[];
  stage: string;
  title: string;
  kind: RuleKind;
  authority: string; // "FMCSA", "PHMSA", "USCIS", "Company", ...
  jurisdiction: "FEDERAL" | "STATE" | "COMPANY";
  /**
   * INTERSTATE_ONLY: federal rule that binds interstate operations; for an
   * intrastate-only operation the state's adopted equivalent governs, so the
   * engine returns UNABLE_TO_DETERMINE until a state pack is loaded.
   * ALL_COMMERCE: applies to interstate and intrastate (e.g. Part 382 for CDL drivers).
   */
  commerceScope: "INTERSTATE_ONLY" | "ALL_COMMERCE" | "NOT_COMMERCE_BASED";
  recordCategory: RecordCategory;
  /**
   * The substance of this requirement is set by a state (new-hire reporting,
   * workers' comp, state accident reports...). Until that state's rule pack is
   * loaded and verified, the engine returns UNABLE_TO_DETERMINE.
   */
  stateDependent?: { stateFact: string; topic: string };
  sources: SourceCitation[];
  appliesWhen: Condition;
  purpose: string;
  applicability: string;
  requiredAction: string[];
  documentation: string[];
  deadline: Deadline;
  retention: RetentionRule[];
  exceptions: string;
  verification: string;
  /** Driver may not perform safety-sensitive functions until this item is verified complete. */
  blocksSafetySensitive: boolean;
  /**
   * What is prohibited until this item is resolved, when it is something other
   * than "the driver performing safety-sensitive functions" — e.g. "Operating
   * this vehicle", "Driving a CMV". Shown in the guide's "Prohibited until
   * complete" summary. Optional so older rule snapshots stay valid.
   */
  prohibits?: string;
  warning?: string;
  effectiveDate: string;
  lastVerified: string | null;
  verificationStatus: VerificationStatus;
  verificationNote?: string;
  changeLog: RuleChange[];
  /**
   * Present only on a version an administrator reviewed, approved and published through the
   * Regulatory Verification workflow. Never set in the code catalog and never set by an automated
   * check. It says the GUIDANCE was reviewed — not that any customer qualifies under it.
   */
  humanReview?: { reviewedAt: string; reviewId: string; reverificationRequired?: boolean };
  /** Shown prominently when an administrator has rejected this guidance and a correction is not yet published. */
  reviewNotice?: string;
}

export interface Evaluation {
  rule: RegulatoryRule;
  classification: Classification;
  /** Human-readable trace of why the engine reached this classification. */
  reasons: string[];
  /** Concrete due date when the deadline anchor fact is known. */
  dueAt: Date | null;
}
