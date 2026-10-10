import type { Condition, RegulatoryRule } from "../types";
import { ecfr } from "./util";

/**
 * Federal rule catalog — "Driver receives a ticket / is arrested or convicted" (catalog 2026.10.2).
 *
 * Facts (from the citation workflow's derive() step):
 *   offense        — "SPEEDING_15" | "OTHER_SERIOUS" | "DUI" | "MINOR" | "OTHER"
 *   vehicle        — "CMV" | "PERSONAL"
 *   stage          — "CITED" | "CONVICTED"
 *   cdlHolder      — boolean
 *   priorSerious   — "YES" | "NO" | "UNKNOWN" (only for serious offenses)
 *   licenseAction  — "YES" | "NO" | "UNKNOWN": licence suspended/revoked as a result
 *   seriousOffense — derived: offense is a Table 2 "serious traffic violation"
 *
 * Verification: checked on 2026-10-09 against a paragraph-level extraction of the
 * eCFR text current through 2026-10-05.
 */

const V = "2026-10-09";
const initial = [{ version: 1, date: V, note: "Initial catalog entry; checked against a paragraph-level extraction of the eCFR text current through 2026-10-05." }];

type Common = Pick<RegulatoryRule, "version" | "workflows" | "authority" | "jurisdiction" | "effectiveDate" | "lastVerified" | "verificationStatus" | "changeLog" | "blocksSafetySensitive" | "recordCategory">;
const fed: Common = {
  version: 1,
  workflows: ["DRIVER_CITATION"],
  authority: "FMCSA",
  jurisdiction: "FEDERAL",
  effectiveDate: "1970-01-01",
  lastVerified: V,
  verificationStatus: "VERIFIED",
  changeLog: initial,
  blocksSafetySensitive: false,
  recordCategory: "DRIVER_QUALIFICATION_FILE",
};
const company: Common = { ...fed, authority: "Company", jurisdiction: "COMPANY" };

const CDL: Condition = { fact: "cdlHolder", isTrue: true };
const CONVICTED: Condition = { fact: "stage", eq: "CONVICTED" };
const DUI: Condition = { fact: "offense", eq: "DUI" };
const SERIOUS: Condition = { fact: "seriousOffense", isTrue: true };
const DQ_FILE = { record: "Driver qualification file", period: "For as long as the driver is employed and for three years thereafter", citation: "49 CFR 391.51(c)" };

export const federalCitationRules: RegulatoryRule[] = [
  // ───────────────────────── Immediately ─────────────────────────
  {
    ...fed,
    id: "FED-382.107-DUI-CMV-ACTUAL-KNOWLEDGE",
    stage: "Immediately",
    title: "DUI citation in a CMV: this is “actual knowledge” of a drug-and-alcohol violation",
    kind: "LEGAL",
    commerceScope: "ALL_COMMERCE",
    recordCategory: "DRUG_ALCOHOL_PROGRAM",
    sources: [ecfr("382.107", "49 CFR 382.107 (definition of “actual knowledge”)"), ecfr("382.705", "49 CFR 382.705(b)(4), (b)(5)")],
    appliesWhen: { all: [DUI, { fact: "vehicle", eq: "CMV" }, CDL] },
    purpose: "An employer’s actual knowledge that a driver used alcohol or controlled substances may be based on a traffic citation for driving a CMV while under the influence — it does not wait for a conviction.",
    applicability: "Applies because a CDL driver was cited for driving a commercial motor vehicle under the influence.",
    requiredAction: [
      "Remove the driver from safety-sensitive functions now.",
      "Treat the citation as actual knowledge of a Part 382 violation and report it to the Drug and Alcohol Clearinghouse by the close of the third business day following the date you obtained that knowledge.",
      "The report includes the driver’s identifiers, the date you obtained actual knowledge, any witnesses, a description of the violation, supporting evidence (such as the citation), and proof that the driver received the reported information.",
      "Open the “positive test, refusal or other drug/alcohol violation” workflow and choose “actual knowledge” for the SAP referral and return-to-duty steps.",
    ],
    documentation: ["Copy of the citation", "Clearinghouse report confirmation", "Proof the driver received the reported information"],
    deadline: { description: "Removal: immediately. Clearinghouse report: by the close of the third business day after obtaining actual knowledge." },
    retention: [{ record: "Records of driver violations", period: "Five years", citation: "49 CFR 382.401(b)(1)" }],
    exceptions: "The definition applies “except as provided in § 382.121” (voluntary self-identification programs).",
    verification: "Clearinghouse shows the report dated inside the deadline; dispatch shows no safety-sensitive work since the citation.",
    blocksSafetySensitive: true,
  },
  {
    ...fed,
    id: "FED-382.107-DUI-PERSONAL-VEHICLE",
    stage: "Immediately",
    title: "DUI in a personal vehicle: not, by itself, a Clearinghouse-reportable violation",
    kind: "LEGAL",
    commerceScope: "ALL_COMMERCE",
    recordCategory: "DRUG_ALCOHOL_PROGRAM",
    sources: [ecfr("382.107", "49 CFR 382.107 (definition of “actual knowledge”)"), ecfr("383.51", "49 CFR 383.51(b), Table 1")],
    appliesWhen: { all: [DUI, { fact: "vehicle", eq: "PERSONAL" }, CDL] },
    purpose: "The two systems are separate: Part 382 governs alcohol and drug use connected with safety-sensitive work; Part 383 governs the licence.",
    applicability: "Applies because the driver was cited or arrested for DUI while driving a personal vehicle off duty.",
    requiredAction: [
      "Do not report the arrest or citation to the Clearinghouse on its own. The bases for “actual knowledge” are: the employer’s direct observation of use, information from a previous employer, a traffic citation for driving a CMV while under the influence, or the employee’s admission of use. A citation in a personal vehicle is not on that list.",
      "Record the determination and the facts it rests on.",
      "Turn to the licence consequences instead: a conviction disqualifies a CDL holder even though it happened in a personal vehicle (see the disqualification step).",
      "Ask whether the State has already suspended the licence administratively — that can happen before any conviction.",
    ],
    documentation: ["Written determination that Part 382 reporting is not triggered, with the facts relied on"],
    deadline: { description: "Make the determination as soon as you learn of the arrest." },
    retention: [DQ_FILE],
    exceptions: "If there is a separate basis — for example the driver admits on-duty or pre-duty use, or reported for duty impaired — Part 382 may apply. Company policy may also impose its own consequences.",
    verification: "Determination signed by the designated employer representative.",
  },
  {
    ...fed,
    id: "FED-383.37-LICENSE-ACTION",
    stage: "Immediately",
    title: "Licence already suspended or revoked: take the driver off the road",
    kind: "LEGAL",
    commerceScope: "ALL_COMMERCE",
    sources: [ecfr("383.37", "49 CFR 383.37(a), (b)"), ecfr("383.33", "49 CFR 383.33"), ecfr("383.51", "49 CFR 383.51(a)(1), (a)(2)")],
    appliesWhen: { fact: "licenseAction", eq: "YES" },
    purpose: "An employer must not allow a driver to operate a CMV once it knows, or should reasonably know, that the driver’s licence is not valid.",
    applicability: "Applies because the driver’s licence has been suspended, revoked or cancelled as a result.",
    requiredAction: [
      "Remove the driver from CMV driving immediately.",
      "The driver must notify you before the end of the business day following the day they received notice of the suspension, revocation, cancellation, lost privilege or disqualification.",
      "Open the “Driver’s CDL is suspended, revoked or disqualified” workflow for the notifications and the reinstatement checks.",
    ],
    documentation: ["State notice or MVR showing the licence action", "Driver’s notification with the date received"],
    deadline: { description: "Immediately." },
    retention: [DQ_FILE],
    exceptions: "None stated.",
    verification: "Dispatch shows no CMV driving since the company knew.",
    prohibits: "The driver operating any CMV until the licence is valid again",
  },

  // ───────────────────────── Reporting ─────────────────────────
  {
    ...company,
    id: "BP-CITATION-REPORTING",
    stage: "Reporting to the company",
    title: "A ticket is not a conviction — track it until it is resolved",
    kind: "BEST_PRACTICE",
    commerceScope: "NOT_COMMERCE_BASED",
    sources: [ecfr("383.31", "49 CFR 383.31(a) (the duty is triggered by conviction — context)")],
    appliesWhen: { fact: "stage", eq: "CITED" },
    purpose: "The federal duty to notify the employer runs from the conviction, which may be months away. Carriers that wait for it are surprised by suspensions.",
    applicability: "Recommended whenever a driver is cited but the case is not yet decided.",
    requiredAction: [
      "Have a written policy that drivers report every citation promptly, and record this one with its court date.",
      "Follow up after the court date and re-run this workflow as “convicted” if that is the outcome. Paying the ticket normally counts as a conviction — confirm with the court or the State.",
      "Check whether the citation was in a CMV: it will usually appear on a roadside inspection report with its own duties.",
    ],
    documentation: ["Driver’s report of the citation", "Court date and outcome"],
    deadline: { description: "Company policy — many carriers require a report within 24 hours." },
    retention: [{ record: "Citation record", period: "Company policy" }],
    exceptions: "Not a federal requirement. A DUI citation in a CMV is different — see the “actual knowledge” step.",
    verification: "Citation is logged with a follow-up date.",
  },
  {
    ...fed,
    id: "FED-383.31-CONVICTION-NOTICE-TO-EMPLOYER",
    stage: "Reporting to the company",
    title: "Conviction: the driver must notify the employer in writing within 30 days",
    kind: "LEGAL",
    commerceScope: "ALL_COMMERCE",
    sources: [ecfr("383.31", "49 CFR 383.31(a), (b)")],
    appliesWhen: { all: [CONVICTED, CDL] },
    purpose: "CDL holders must report traffic convictions to their employer whatever vehicle they were driving.",
    applicability: "Applies because a CDL holder has been convicted.",
    requiredAction: [
      "A CDL holder convicted of violating a State or local law relating to motor vehicle traffic control — in any type of motor vehicle, other than a parking violation — must notify their current employer within 30 days after the date of conviction.",
      "The notice must be in writing and contain: the driver’s full name; driver’s licence number; date of conviction; the specific offence(s) and any suspension, revocation or cancellation of driving privileges that resulted; whether the violation was in a commercial motor vehicle; the location of the offence; and the driver’s signature.",
      "File the notice in the driver qualification file.",
    ],
    documentation: ["Driver’s written conviction notice containing all seven items"],
    deadline: { description: "Within 30 days after the date of conviction." },
    retention: [DQ_FILE],
    exceptions: "Parking violations are excluded.",
    verification: "Notice is complete, signed and dated within 30 days of the conviction.",
  },

  // ───────────────────────── Disqualification ─────────────────────────
  {
    ...fed,
    id: "FED-383.51C-SERIOUS-TRAFFIC-VIOLATION",
    stage: "Will the driver be disqualified?",
    title: "Serious traffic violation: one conviction does not disqualify — a second within 3 years does",
    kind: "LEGAL",
    commerceScope: "ALL_COMMERCE",
    sources: [ecfr("383.51", "49 CFR 383.51(c), Table 2")],
    appliesWhen: { all: [SERIOUS, CDL] },
    purpose: "Repeat serious violations lead to a fixed federal disqualification on top of anything the State does.",
    applicability: "Applies because the offence is one of the “serious traffic violations” for CDL holders.",
    requiredAction: [
      "Know the list: speeding 15 mph or more above the limit; reckless driving; improper or erratic lane changes; following too closely; a traffic-control violation connected with a fatal accident; driving a CMV without obtaining a CLP/CDL, without it in possession, or without the proper class or endorsements; and texting or using a hand-held mobile telephone while driving a CMV.",
      "A second conviction for any combination of these in separate incidents within a 3-year period means a 60-day disqualification; a third or subsequent conviction means 120 days.",
      "For the first five offences, a conviction in a personal vehicle counts only if it results in the revocation, cancellation or suspension of the driver’s licence or non-CMV driving privileges. The CMV-specific offences do not apply in a personal vehicle.",
      "Check the driver’s MVR for other serious-violation convictions in the last 3 years.",
    ],
    documentation: ["Current MVR", "Note of prior serious-violation convictions and their dates"],
    deadline: { description: "Check the record when the citation is reported; act when a conviction is entered." },
    retention: [DQ_FILE],
    exceptions: "A driver cited for not having the CLP/CDL in possession who proves to the citing authority, by the court or payment date, that they held a valid licence on the day is not guilty of that offence (Table 2, footnote 1).",
    verification: "MVR reviewed and the count of serious-violation convictions in the last 3 years recorded.",
  },
  {
    ...fed,
    id: "FED-383.51C-DISQUALIFICATION-DUE",
    stage: "Will the driver be disqualified?",
    title: "Second serious conviction in 3 years: the driver is disqualified",
    kind: "LEGAL",
    commerceScope: "ALL_COMMERCE",
    sources: [ecfr("383.51", "49 CFR 383.51(a)(1), (a)(2), (c), Table 2")],
    appliesWhen: { all: [SERIOUS, CDL, CONVICTED, { fact: "priorSerious", eq: "YES" }] },
    purpose: "A disqualified person must not drive a CMV, and an employer must not knowingly allow it.",
    applicability: "Applies because this conviction is at least the driver’s second serious traffic violation within 3 years.",
    requiredAction: [
      "Expect a disqualification of 60 days (second conviction) or 120 days (third or subsequent) and confirm its start and end dates with the licensing State or on the MVR.",
      "Do not allow the driver to operate a CMV during the disqualification.",
      "Use the “Driver’s CDL is suspended, revoked or disqualified” workflow for the notifications and the checks before the driver returns.",
    ],
    documentation: ["MVR or State notice showing the disqualification dates"],
    deadline: { description: "From the disqualification’s effective date." },
    retention: [DQ_FILE],
    exceptions: "A personal-vehicle conviction counts only if it results in revocation, cancellation or suspension of the licence or non-CMV driving privileges.",
    verification: "Disqualification dates are recorded and dispatch shows no CMV driving within them.",
    prohibits: "The driver operating a CMV during the 60- or 120-day disqualification",
  },
  {
    ...fed,
    id: "FED-383.51B-MAJOR-OFFENSE",
    stage: "Will the driver be disqualified?",
    title: "DUI conviction: at least a 1-year CDL disqualification — even in a personal vehicle",
    kind: "LEGAL",
    commerceScope: "ALL_COMMERCE",
    sources: [ecfr("383.51", "49 CFR 383.51(b), Table 1"), ecfr("383.51", "49 CFR 383.51(a)(3), (a)(4)")],
    appliesWhen: { all: [DUI, CDL] },
    purpose: "Driving under the influence is a “major offence”: a conviction removes CDL privileges whether the driver was in a truck or their own car.",
    applicability: "Applies because a CDL holder is charged with, or convicted of, driving under the influence or refusing a test.",
    requiredAction: [
      "A first conviction for being under the influence of alcohol or a controlled substance, or for refusing an alcohol test under implied-consent laws, means a 1-year disqualification — whether the driver was operating a CMV or a non-CMV.",
      "The period is 3 years if the driver was operating a CMV transporting hazardous materials.",
      "A second conviction for any major offence in a separate incident means disqualification for life.",
      "Plan now for the driver being unavailable for at least a year if convicted. Until a conviction or a State licence action, Part 383 does not itself disqualify the driver.",
    ],
    documentation: ["Court record or MVR showing the outcome", "State disqualification notice"],
    deadline: { description: "Disqualification follows conviction; a State administrative suspension may come sooner." },
    retention: [DQ_FILE],
    exceptions: "Having an alcohol concentration of 0.04 or greater is a major offence only when operating a CMV. A State may reinstate a lifetime disqualification after 10 years in some cases (383.51(a)(6)).",
    verification: "Outcome and disqualification dates are recorded in the driver qualification file.",
  },

  // ───────────────────────── Records ─────────────────────────
  {
    ...fed,
    id: "FED-391.25-CONSIDER-AT-ANNUAL-REVIEW",
    stage: "Records and review",
    title: "Weigh the conviction at the annual driving-record review",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("391.25", "49 CFR 391.25(a), (b), (c)")],
    appliesWhen: CONVICTED,
    purpose: "At least once every 12 months the carrier must decide whether each driver still meets the minimum requirements for safe driving.",
    applicability: "Applies because the driver has a conviction that will appear on the motor vehicle record.",
    requiredAction: [
      "At least once every 12 months, obtain the driver’s MVR from each licensing authority and review it to determine whether the driver meets the minimum requirements for safe driving or is disqualified under § 391.15.",
      "Consider the driver’s accident record and any evidence of violations of motor vehicle laws, giving great weight to violations — such as speeding, reckless driving and operating while under the influence of alcohol or drugs — that indicate a disregard for the safety of the public.",
      "Keep the MVR in the driver qualification file together with a note of who performed the review and the date.",
      "You do not have to wait for the scheduled review — pulling a fresh MVR now is good practice.",
    ],
    documentation: ["MVR", "Review note with the reviewer’s name and the date"],
    deadline: { description: "At least once every 12 months." },
    retention: [{ record: "Annual MVR and review note", period: "May be removed three years after the date of execution", citation: "49 CFR 391.51(d)(1), (d)(2)" }],
    exceptions: "Subpart G of Part 391 contains limited exemptions.",
    verification: "The most recent review note is dated within the last 12 months and mentions this conviction.",
  },
  {
    ...company,
    id: "BP-CITATION-CORRECTIVE-ACTION",
    stage: "Records and review",
    title: "Decide and record the company’s response",
    kind: "BEST_PRACTICE",
    commerceScope: "NOT_COMMERCE_BASED",
    sources: [ecfr("391.25", "49 CFR 391.25(b)(2) (context)")],
    appliesWhen: { always: true },
    purpose: "Consistent, documented responses to violations are what an investigator — and your insurer — will look for.",
    applicability: "Recommended for every citation or conviction.",
    requiredAction: [
      "Apply your written policy consistently: coaching, retraining, a warning or other action in proportion to the offence.",
      "For speeding and following-too-closely, review telematics or ELD speed data for a pattern.",
      "Tell your insurer if your policy requires it.",
    ],
    documentation: ["Corrective-action record"],
    deadline: { description: "Within a few days of learning of the citation or conviction." },
    retention: [{ record: "Corrective-action record", period: "Company policy" }],
    exceptions: "Not a regulatory requirement.",
    verification: "Record is on file and signed.",
  },
  {
    ...fed,
    id: "STATE-CITATION-CONSEQUENCES",
    stage: "Will the driver be disqualified?",
    title: "State points, suspensions and court requirements",
    kind: "LEGAL",
    authority: "State driver licensing agency / court",
    jurisdiction: "STATE",
    commerceScope: "NOT_COMMERCE_BASED",
    stateDependent: { stateFact: "licenseState", topic: "traffic convictions" },
    sources: [{ citation: "State law (varies)", url: "https://www.fmcsa.dot.gov/" }],
    appliesWhen: { always: true },
    purpose: "Points, administrative suspensions, fines and whether a ticket can be masked or deferred are set by State law. Federal rules restrict masking of CDL holders’ convictions.",
    applicability: "Depends on the State that issued the licence and the State where the offence occurred.",
    requiredAction: ["Have the driver confirm the court date, the possible licence consequences and any administrative suspension with the State.", "Do not assume a deferral or diversion programme is available to a CDL holder."],
    documentation: ["Court and State correspondence"],
    deadline: { description: "State-specific — see the citation." },
    retention: [{ record: "Court and State correspondence", period: "Keep in the driver qualification file" }],
    exceptions: "—",
    verification: "Outcome confirmed in writing.",
    lastVerified: null,
    verificationStatus: "REQUIRES_VERIFICATION",
    verificationNote: "State-specific; state rule packs are not loaded. The federal anti-masking rule (49 CFR 384.226) was not read for this release.",
  },
];
