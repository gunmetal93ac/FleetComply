import type { Condition, RegulatoryRule } from "../types";
import { ecfr } from "./util";

/**
 * Federal rule catalog — "Driver is out of hours / exceeded hours-of-service limits".
 *
 * Scope: property-carrying vehicles (49 CFR 395.3). Passenger-carrying limits
 * (§ 395.5) are NOT loaded — the workflow returns a review item instead.
 *
 * Facts (from the HOS workflow's derive() step):
 *   situation        — "EXCEEDED" | "ABOUT_TO"
 *   vehicleType      — "PROPERTY" | "PASSENGER"
 *   cause            — "ADVERSE" | "EMERGENCY" | "DISPATCH" | "DRIVER" | "UNKNOWN"
 *   knownBeforehand  — "YES" | "NO" | "UNKNOWN" (only when cause is ADVERSE)
 *   foundBy          — "ROADSIDE" | "INTERNAL"
 *   operationType / operatingState — drive the interstate-only logic in the engine
 *
 * Verification: checked on 2026-10-09 against a paragraph-level extraction of the
 * eCFR text current through 2026-10-05.
 */

const V = "2026-10-09";
const initial = [{ version: 1, date: V, note: "Initial catalog entry; checked against a paragraph-level extraction of the eCFR text current through 2026-10-05." }];

type Common = Pick<RegulatoryRule, "version" | "workflows" | "authority" | "jurisdiction" | "effectiveDate" | "lastVerified" | "verificationStatus" | "changeLog" | "blocksSafetySensitive" | "recordCategory">;
const fed: Common = {
  version: 1,
  workflows: ["HOS_VIOLATION"],
  authority: "FMCSA",
  jurisdiction: "FEDERAL",
  effectiveDate: "1970-01-01",
  lastVerified: V,
  verificationStatus: "VERIFIED",
  changeLog: initial,
  blocksSafetySensitive: false,
  recordCategory: "COMPANY_RECORDS",
};
const company: Common = { ...fed, authority: "Company", jurisdiction: "COMPANY" };

const PROPERTY: Condition = { fact: "vehicleType", eq: "PROPERTY" };
const ADVERSE: Condition = { fact: "cause", eq: "ADVERSE" };

export const federalHosRules: RegulatoryRule[] = [
  // ───────────────────────── Right now ─────────────────────────
  {
    ...fed,
    id: "FED-395.3-NO-DRIVING-PAST-LIMITS",
    stage: "Right now",
    title: "The driver must not drive past an hours-of-service limit",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("395.3", "49 CFR 395.3(a), (b), (c)")],
    appliesWhen: PROPERTY,
    purpose: "The limits exist to keep fatigued drivers off the road. They bind the driver and the carrier: no motor carrier shall permit or require a driver to drive in violation of them.",
    applicability: "Drivers of property-carrying commercial motor vehicles, regardless of how many motor carriers use the driver’s services. Exceptions are in § 395.1.",
    requiredAction: [
      "Do not permit or require the driver to drive once any of these limits is reached, and the driver must not drive:",
      "• Driving requires first taking 10 consecutive hours off duty.",
      "• No driving after a period of 14 consecutive hours after coming on duty following 10 consecutive hours off duty.",
      "• A total of 11 hours of driving within that 14-hour period.",
      "• No driving if more than 8 hours of driving time have passed without at least a consecutive 30-minute interruption in driving status (the interruption may be off-duty, sleeper-berth, or on-duty not-driving time, or a combination).",
      "• No driving after having been on duty 60 hours in any 7 consecutive days (carrier does not operate every day of the week) or 70 hours in any 8 consecutive days (carrier operates every day).",
      "Work out which limit is involved and when the driver may lawfully drive again: after 10 consecutive hours off duty for the daily limits; a 7- or 8-day period may end with the start of an off-duty period of 34 or more consecutive hours.",
      "If the load cannot wait, arrange a relief driver or reschedule the delivery — do not ask the driver to continue.",
    ],
    documentation: ["Driver’s record of duty status for the day and the prior 7 days", "Dispatch note of the decision made (relief driver, delay, layover)"],
    deadline: { description: "Immediately — the prohibition applies the moment a limit is reached." },
    retention: [{ record: "Records of duty status and supporting documents", period: "Not less than 6 months from the date of receipt", citation: "49 CFR 395.8(k)(1)" }],
    exceptions:
      "§ 395.1 contains the exceptions (adverse driving conditions, emergency conditions, short-haul, sleeper berth and others). The 30-minute interruption rule does not apply to drivers who qualify for the short-haul exceptions in § 395.1(e)(1) or (2). The limits in § 395.3 are stated as limits on driving.",
    verification: "Safety manager confirms from the ELD record that no driving time was recorded after the limit, or records the violation and the corrective action.",
    prohibits: "The driver driving a CMV until the required off-duty time has been taken",
  },
  {
    ...fed,
    id: "REVIEW-395.5-PASSENGER-LIMITS",
    stage: "Right now",
    title: "Passenger-carrying vehicle: different limits apply",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("395.5", "49 CFR 395.5 (maximum driving time for passenger-carrying vehicles)")],
    appliesWhen: { fact: "vehicleType", eq: "PASSENGER" },
    purpose: "Passenger-carrying drivers are governed by § 395.5, which sets different driving and on-duty limits from the property-carrying rules.",
    applicability: "Applies because the driver operates a passenger-carrying commercial motor vehicle.",
    requiredAction: [
      "Do not rely on the 11-hour / 14-hour property-carrying limits. Read § 395.5 for the limits that apply to passenger-carrying vehicles.",
      "Do not permit the driver to drive beyond those limits.",
    ],
    documentation: ["Driver’s record of duty status"],
    deadline: { description: "Immediately." },
    retention: [{ record: "Records of duty status and supporting documents", period: "Not less than 6 months from the date of receipt", citation: "49 CFR 395.8(k)(1)" }],
    exceptions: "See § 395.1.",
    verification: "A qualified person confirms the applicable limit from the current text of § 395.5.",
    lastVerified: null,
    verificationStatus: "REQUIRES_VERIFICATION",
    verificationNote: "FleetComply has not loaded the passenger-carrying limits in § 395.5. This workflow’s steps were written for property-carrying vehicles.",
  },

  // ───────────────────────── Does an exception apply? ─────────────────────────
  {
    ...fed,
    id: "FED-395.1B1-ADVERSE-APPLIES",
    stage: "Does an exception apply?",
    title: "Adverse driving conditions: up to 2 extra hours may be allowed",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("395.1", "49 CFR 395.1(b)(1)"), ecfr("395.2", "49 CFR 395.2 (definition of “adverse driving conditions”)")],
    appliesWhen: { all: [ADVERSE, { fact: "knownBeforehand", eq: "NO" }] },
    purpose: "A driver who meets conditions that could not have been anticipated may need extra time to finish the run or reach a safe place.",
    applicability: "Applies because the delay was caused by weather, road or traffic conditions that were not known, and could not reasonably have been known, beforehand.",
    requiredAction: [
      "Confirm the conditions meet the definition: snow, ice, sleet, fog or other adverse weather, or unusual road or traffic conditions, that were not known, or could not reasonably be known, to the driver immediately before starting the duty day (or before resuming driving after a qualifying rest break or sleeper-berth period), or to the motor carrier immediately before dispatching the driver.",
      "If they do, the driver may drive for not more than two additional hours beyond the maximum allowable hours in § 395.3(a), in order to complete the run or to reach a place offering safety and security for the occupants, the vehicle and its cargo.",
      "The allowance is capped at two additional hours. Driving beyond that is a violation even in bad conditions.",
      "Record what the conditions were, where and when they were met, and why they could not have been known in advance.",
    ],
    documentation: ["ELD annotation describing the conditions (recommended)", "Supporting evidence: weather alerts, road-closure notices, traffic incident reports, dispatch messages"],
    deadline: { description: "Record the facts the same day, while they can be verified." },
    retention: [{ record: "Records of duty status and supporting documents", period: "Not less than 6 months from the date of receipt", citation: "49 CFR 395.8(k)(1)" }],
    exceptions: "Does not apply where § 395.1(h)(3) governs. Conditions that were forecast or known at dispatch — and ordinary, predictable congestion — do not meet the definition.",
    verification: "Safety manager checks the evidence against the definition and confirms no more than two additional hours were used.",
  },
  {
    ...fed,
    id: "FED-395.1B1-ADVERSE-NOT-AVAILABLE",
    stage: "Does an exception apply?",
    title: "Adverse driving conditions exception does not apply — the conditions were known",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("395.1", "49 CFR 395.1(b)(1)"), ecfr("395.2", "49 CFR 395.2 (definition of “adverse driving conditions”)")],
    appliesWhen: { all: [ADVERSE, { fact: "knownBeforehand", eq: "YES" }] },
    purpose: "The exception is only for conditions that could not have been anticipated.",
    applicability: "Applies because the conditions were known, or reasonably knowable, to the driver or dispatcher beforehand.",
    requiredAction: [
      "Do not claim the adverse driving conditions exception: the definition requires that the conditions were not known, and could not reasonably be known, to the driver before starting the duty day or resuming driving after rest, or to the carrier before dispatch.",
      "Treat any driving beyond the § 395.3 limits as a violation and follow the corrective-action steps below.",
    ],
    documentation: ["Note of what was known and when (forecasts, alerts, dispatch messages)"],
    deadline: { description: "Decide before any further driving is planned around the exception." },
    retention: [{ record: "Records of duty status and supporting documents", period: "Not less than 6 months from the date of receipt", citation: "49 CFR 395.8(k)(1)" }],
    exceptions: "—",
    verification: "Safety manager documents the determination.",
  },
  {
    ...fed,
    id: "FED-395.1B2-EMERGENCY",
    stage: "Does an exception apply?",
    title: "Emergency conditions: the run may be completed if it could have been finished without the emergency",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("395.1", "49 CFR 395.1(b)(2)")],
    appliesWhen: { fact: "cause", eq: "EMERGENCY" },
    purpose: "A genuine emergency should not turn an otherwise legal run into a violation.",
    applicability: "Applies because the delay was caused by an emergency.",
    requiredAction: [
      "In case of any emergency, a driver may complete the run without being in violation of Part 395 if the run reasonably could have been completed absent the emergency.",
      "Test it honestly: was the trip planned so that it would have finished within the limits if the emergency had not happened? If not, the exception does not cover it.",
      "Record what the emergency was and how the original plan fitted within the limits.",
    ],
    documentation: ["ELD annotation describing the emergency (recommended)", "Trip plan / dispatch record showing the run fitted within the limits", "Evidence of the emergency"],
    deadline: { description: "Record the facts the same day." },
    retention: [{ record: "Records of duty status and supporting documents", period: "Not less than 6 months from the date of receipt", citation: "49 CFR 395.8(k)(1)" }],
    exceptions: "The regulation does not define “emergency” in this paragraph or set a number of extra hours. Routine delays (loading, traffic, breakdowns of a kind that could be planned for) should not be assumed to qualify — have a qualified person review borderline cases.",
    verification: "Safety manager reviews the trip plan against the limits and signs the determination.",
  },

  // ───────────────────────── Keep the record accurate ─────────────────────────
  {
    ...fed,
    id: "FED-395.8E-ACCURATE-RECORDS",
    stage: "Keep the record accurate",
    title: "The log must show what actually happened — no false entries, no altered ELD data",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("395.8", "49 CFR 395.8(e)"), ecfr("395.30", "49 CFR 395.30(c), (d), (e), (f)")],
    appliesWhen: { always: true },
    purpose: "An hours violation is a compliance problem; a falsified record to hide it is a far more serious one.",
    applicability: "Every driver required to keep a record of duty status, and their motor carrier.",
    requiredAction: [
      "No driver or motor carrier may make a false report in connection with a duty status.",
      "Do not disable, deactivate, jam, reprogram or otherwise tamper with an ELD so that it does not accurately record and retain the required data, or permit or require anyone else to.",
      "The driver may edit, add missing information and annotate records through the ELD; every change or addition must be annotated.",
      "The carrier may propose edits only after the driver has submitted the record, and each proposed edit takes effect only if the driver confirms it and recertifies the record.",
      "The carrier must not coerce a driver to make a false certification, and must not alter or erase the original hours-of-service information or the ELD’s source data.",
    ],
    documentation: ["Certified record of duty status showing the actual times", "Annotations explaining any edit"],
    deadline: { description: "The driver certifies each 24-hour record after the final entry and submits it to the carrier within 13 days (49 CFR 395.8(a)(2)(ii))." },
    retention: [{ record: "Records of duty status and supporting documents", period: "Not less than 6 months from the date of receipt", citation: "49 CFR 395.8(k)(1)" }],
    exceptions: "Team-driver records may be reassigned between co-drivers using the ELD’s procedure where driving time was assigned to the wrong driver (395.30(c)(3)).",
    verification: "Safety manager compares the certified record with GPS/ELD data and supporting documents; edits carry annotations and the driver’s recertification.",
    warning: "Do not “fix” an hours violation by changing the log. Record it accurately and correct the cause.",
  },
  {
    ...fed,
    id: "FED-395.8K-RETAIN-RODS",
    stage: "Keep the record accurate",
    title: "Keep the logs and supporting documents for 6 months",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("395.8", "49 CFR 395.8(k)")],
    appliesWhen: { always: true },
    purpose: "Records must be available to investigators and to defend the carrier’s handling of the event.",
    applicability: "Every motor carrier and driver subject to § 395.8.",
    requiredAction: [
      "The motor carrier must retain records of duty status and supporting documents for not less than 6 months from the date of receipt.",
      "The driver must keep a copy of each record for the previous 7 consecutive days, available for inspection while on duty.",
    ],
    documentation: ["Records of duty status", "Supporting documents"],
    deadline: { description: "Ongoing — 6 months from the date of receipt." },
    retention: [{ record: "Records of duty status and supporting documents", period: "Not less than 6 months from the date of receipt", citation: "49 CFR 395.8(k)(1)" }],
    exceptions: "Short-haul drivers exempt from § 395.8 under § 395.1(e)(1): the carrier instead keeps accurate time records for 6 months.",
    verification: "The records for the day in question can be produced from the ELD system or file.",
  },

  // ───────────────────────── Correct the cause ─────────────────────────
  {
    ...company,
    id: "BP-HOS-CORRECTIVE-ACTION",
    stage: "Correct the cause",
    title: "Find the cause and fix it — the carrier is responsible too",
    kind: "BEST_PRACTICE",
    commerceScope: "NOT_COMMERCE_BASED",
    sources: [ecfr("395.3", "49 CFR 395.3(a) (“no motor carrier shall permit or require…” — context)")],
    appliesWhen: { always: true },
    purpose: "§ 395.3 prohibits the carrier from permitting or requiring driving over the limits, so a violation is a question about dispatch and planning as well as the driver.",
    applicability: "Recommended after any hours-of-service violation or near miss.",
    requiredAction: [
      "Review the trip plan: was the schedule achievable within the limits, including loading, fuel and the 30-minute interruption?",
      "Check whether dispatch knew the driver’s remaining hours and whether anyone pressed the driver to continue.",
      "Coach or retrain the driver or dispatcher as the facts warrant, and record what was done.",
      "Look for a pattern across recent logs for this driver, lane or customer.",
    ],
    documentation: ["Log-audit note", "Coaching / training record"],
    deadline: { description: "Recommended within a few days." },
    retention: [{ record: "Corrective-action record", period: "Company policy" }],
    exceptions: "Not a regulatory requirement.",
    verification: "Corrective-action note is on file and reviewed by the safety manager.",
  },
  {
    ...company,
    id: "BP-HOS-ROADSIDE-POINTER",
    stage: "Correct the cause",
    title: "Cited at a roadside inspection? Run the roadside inspection workflow too",
    kind: "BEST_PRACTICE",
    commerceScope: "NOT_COMMERCE_BASED",
    sources: [ecfr("396.9", "49 CFR 396.9(d)"), ecfr("395.13", "49 CFR 395.13")],
    appliesWhen: { fact: "foundBy", eq: "ROADSIDE" },
    purpose: "A roadside inspection report carries its own duties: delivering the report, certifying corrections within 15 days, and — if the driver was placed out of service — delivering the certification of action taken.",
    applicability: "Applies because the violation was found at a roadside inspection.",
    requiredAction: ["Open the “Vehicle fails a roadside inspection” or “Driver receives an out-of-service order” workflow and complete its steps alongside this one."],
    documentation: ["Inspection report"],
    deadline: { description: "Start now — that workflow has 24-hour and 15-day deadlines counted from the inspection." },
    retention: [{ record: "Inspection report copy", period: "12 months from the date of the inspection", citation: "49 CFR 396.9(d)(3)(ii)" }],
    exceptions: "—",
    verification: "Roadside workflow has been started for the same inspection.",
  },
];
