import type { Condition, RegulatoryRule } from "../types";
import { ecfr } from "./util";

/**
 * Federal rule catalog — "Driver moves to another state" (catalog 2026.10.3).
 *
 * The federal rule is short: a CDL holder who establishes a new State of domicile must apply
 * to transfer the CDL within 30 days (§ 383.71(c)). Almost everything else — what the new
 * State's licensing agency asks for, its fees, tests and its own deadlines for an ordinary
 * licence or vehicle registration — is State law. No state rule pack is loaded, so those items
 * are flagged and the user is sent to the official agency; nothing State-specific is asserted.
 *
 * Facts: cdlHolder (boolean), licenseKind ("DOMICILED" | "NON_DOMICILED"), domicileEstablished
 * ("YES" | "NO" | "UNKNOWN"), domicileEstablishedOn (date), hazmatEndorsement, medicalVariance (booleans),
 * fromState, toState, operationType / operatingState.
 *
 * Verification: checked on 2026-10-10 against a paragraph-level extraction of the eCFR text
 * current through 2026-10-05.
 */

const V = "2026-10-10";
const initial = [{ version: 1, date: V, note: "Initial catalog entry; checked against a paragraph-level extraction of the eCFR text current through 2026-10-05." }];

type Common = Pick<RegulatoryRule, "version" | "workflows" | "authority" | "jurisdiction" | "effectiveDate" | "lastVerified" | "verificationStatus" | "changeLog" | "blocksSafetySensitive" | "recordCategory" | "commerceScope">;
const fed: Common = {
  version: 1,
  workflows: ["DRIVER_RELOCATION"],
  authority: "FMCSA",
  jurisdiction: "FEDERAL",
  effectiveDate: "1970-01-01",
  lastVerified: V,
  verificationStatus: "VERIFIED",
  changeLog: initial,
  blocksSafetySensitive: false,
  recordCategory: "DRIVER_QUALIFICATION_FILE",
  commerceScope: "ALL_COMMERCE",
};
const company: Common = { ...fed, authority: "Company", jurisdiction: "COMPANY", commerceScope: "NOT_COMMERCE_BASED" };
const review = { lastVerified: null, verificationStatus: "REQUIRES_VERIFICATION" as const };

const CDL: Condition = { fact: "cdlHolder", isTrue: true };
const DOMICILED_CDL: Condition = { all: [CDL, { fact: "licenseKind", eq: "DOMICILED" }] };
const MOVED: Condition = { fact: "domicileEstablished", eq: "YES" };
const DQ_FILE = { record: "Driver qualification file", period: "For as long as the driver is employed and for three years thereafter", citation: "49 CFR 391.51(c)" };

export const federalRelocationRules: RegulatoryRule[] = [
  // ───────────────────────── Has the driver's domicile changed? ─────────────────────────
  {
    ...fed,
    id: "FED-383.5-STATE-OF-DOMICILE",
    stage: "Has the driver’s domicile changed?",
    title: "Decide whether the driver has actually established a new State of domicile",
    kind: "LEGAL",
    sources: [ecfr("383.5", "49 CFR 383.5 (definition of “State of domicile”)"), ecfr("383.71", "49 CFR 383.71(c)(7)")],
    appliesWhen: { always: true },
    purpose: "The licensing clock starts when domicile changes — not when a driver takes a job, a load or a temporary address in another State.",
    applicability: "Every driver who relocates.",
    requiredAction: [
      "State of domicile means the State where a person has their true, fixed and permanent home and principal residence, and to which they intend to return whenever absent.",
      "Ask the driver the questions that decide it: where is your permanent home now, do you intend to return to the old State, and on what date did the new address become your principal residence?",
      "Working away from home, staying in temporary housing for a contract, or running routes in another State does not by itself change domicile.",
      "Record the date the driver says the new domicile was established — the transfer deadline is counted from it.",
    ],
    documentation: ["Driver’s written statement of new residential address and the date domicile was established"],
    deadline: { description: "As soon as the driver tells you they are moving." },
    retention: [DQ_FILE],
    exceptions: "A driver may hold only one licence, issued by the State of domicile.",
    verification: "Driver’s statement is signed and dated.",
  },
  {
    ...company,
    id: "BP-RELOCATION-NOT-YET-DOMICILED",
    stage: "Has the driver’s domicile changed?",
    title: "Not yet domiciled in the new State: nothing to transfer yet — set a reminder",
    kind: "BEST_PRACTICE",
    sources: [ecfr("383.71", "49 CFR 383.71(c) (context)")],
    appliesWhen: { fact: "domicileEstablished", eq: "NO" },
    purpose: "The transfer duty arises when the new domicile is established.",
    applicability: "Applies because the driver has not yet established domicile in the new State.",
    requiredAction: [
      "Keep the current licence and records as they are.",
      "Ask the driver to tell you the day the move becomes permanent, and diary a follow-up.",
      "Re-run this workflow when the driver has moved.",
    ],
    documentation: ["Note of the planned move date"],
    deadline: { description: "Follow up on the planned move date." },
    retention: [{ record: "Note", period: "Company policy" }],
    exceptions: "Not a regulatory requirement.",
    verification: "Follow-up is diarised.",
  },

  // ───────────────────────── Transfer the licence ─────────────────────────
  {
    ...fed,
    id: "FED-383.71C-TRANSFER-CDL-WITHIN-30-DAYS",
    stage: "Transfer the licence",
    title: "The driver must apply to transfer the CDL within 30 days of establishing the new domicile",
    kind: "LEGAL",
    sources: [ecfr("383.71", "49 CFR 383.71(c)"), ecfr("383.5", "49 CFR 383.5 (State of domicile)")],
    appliesWhen: { all: [DOMICILED_CDL, MOVED] },
    purpose: "A CDL must be issued by the driver’s State of domicile.",
    applicability: "Applies because a CDL holder has established domicile in a new State.",
    requiredAction: [
      "The driver must apply for a transfer CDL from the new State of domicile no more than 30 days after establishing the new domicile.",
      "When applying the driver must: make the required certifications, including the self-certification of the type of driving (interstate or intrastate, excepted or non-excepted) and that they are not disqualified and hold no other licence; provide updated information; surrender the CDL from the old State to the new State; give the names of all States where they were licensed to drive any type of motor vehicle during the previous 10 years; provide proof of U.S. citizenship or lawful permanent residency; and prove the new State is their State of domicile with a document showing their name and residential address there.",
      "Give the driver time off to attend the licensing office, and ask for a copy of the new licence the day it is issued.",
    ],
    documentation: ["Copy of the new CDL", "Driver’s note of the date applied"],
    deadline: { description: "No more than 30 days after establishing the new domicile.", anchor: "domicileEstablishedOn", offsetDays: 30 },
    retention: [DQ_FILE],
    exceptions: "What the new State’s office requires in practice — appointments, fees, tests, documents it accepts — is set by that State. See the State item.",
    verification: "New CDL from the new State is on file, issued within 30 days of the domicile date.",
  },
  {
    ...fed,
    id: "FED-383.37-ONE-VALID-CDL-DURING-TRANSFER",
    stage: "Transfer the licence",
    title: "Can the driver keep driving during the transfer? Only on one valid CDL",
    kind: "LEGAL",
    sources: [ecfr("383.37", "49 CFR 383.37(a), (c)"), ecfr("383.71", "49 CFR 383.71(c)"), ecfr("391.11", "49 CFR 391.11(b)(5)")],
    appliesWhen: CDL,
    purpose: "An employer must not use a driver who has no current CDL, or who holds more than one.",
    applicability: "Every CDL holder in the middle of a transfer.",
    requiredAction: [
      "The driver may operate only while holding a current CDL of the proper class with the endorsements needed. An employer must not allow a driver to operate a CMV if it knows or should reasonably know the driver has no current CDL, or has more than one CDL.",
      "The federal rule gives the driver up to 30 days from establishing domicile to apply. It does not say the old State’s licence stays valid after that, and it is the States that decide when the old licence stops being valid — confirm with both licensing agencies before relying on the old licence beyond the 30 days.",
      "The old CDL is surrendered to the new State. If the new State issues a temporary or paper licence, confirm it authorizes commercial driving and for how long, and keep a copy.",
      "If there is any gap in which the driver holds no valid CDL, take them off CMV driving for that period.",
    ],
    documentation: ["Copy of whatever licence document the driver holds at each stage", "Dispatch record covering any gap"],
    deadline: { description: "Throughout the transfer." },
    retention: [DQ_FILE],
    exceptions: "None in the cited sections.",
    verification: "For every day the driver was dispatched there is a valid CDL on file.",
    prohibits: "The driver operating a CMV on any day they do not hold one valid CDL",
  },
  {
    ...fed,
    id: "FED-383.71C-HAZMAT-ENDORSEMENT-ON-TRANSFER",
    stage: "Transfer the licence",
    title: "Hazardous materials endorsement: extra requirements to keep it on transfer",
    kind: "LEGAL",
    sources: [ecfr("383.71", "49 CFR 383.71(c)(3), (b)(8)")],
    appliesWhen: { all: [CDL, { fact: "hazmatEndorsement", isTrue: true }] },
    purpose: "The endorsement does not simply carry over; security and State requirements must be met again.",
    applicability: "Applies because the driver holds a hazardous materials endorsement.",
    requiredAction: [
      "To retain the hazardous materials endorsement on the transferred CDL the driver must comply with the Transportation Security Administration requirements in 49 CFR Part 1572 and with the new State’s requirements for the endorsement. Lawful permanent residents must also provide their USCIS alien registration number.",
      "Start early: ask the new State’s licensing agency what it requires for the endorsement (for example a knowledge test or a new security threat assessment) and how long it takes.",
      "Do not dispatch the driver on a placarded load unless the licence they are holding that day shows the endorsement.",
    ],
    documentation: ["New CDL showing the hazardous materials endorsement", "Any TSA or State confirmation the driver receives"],
    deadline: { description: "As part of the transfer application." },
    retention: [DQ_FILE],
    exceptions: "The detailed TSA procedure in 49 CFR Part 1572 and each State’s testing rule were not read for this entry — the driver should confirm them with the new State.",
    verification: "Endorsement appears on the new CDL before any placarded load is assigned.",
    prohibits: "Assigning placarded hazardous-materials loads unless the current licence shows the endorsement",
  },
  {
    ...fed,
    id: "REVIEW-NON-DOMICILED-CDL",
    stage: "Transfer the licence",
    title: "Non-domiciled CDL holder: different rules apply",
    kind: "LEGAL",
    sources: [ecfr("383.71", "49 CFR 383.71(f)"), ecfr("383.23", "49 CFR 383.23(b)")],
    appliesWhen: { all: [CDL, { fact: "licenseKind", eq: "NON_DOMICILED" }] },
    purpose: "A non-domiciled CDL is issued to a person domiciled in a foreign jurisdiction, or in a State that cannot issue CDLs, and is not transferred in the same way.",
    applicability: "Applies because the driver holds a non-domiciled CDL or CLP.",
    requiredAction: [
      "Do not assume the 30-day transfer procedure applies. Have the driver contact the licensing agency of the State that issued the non-domiciled CDL, and the agency of the new State, before moving.",
      "The holder must notify the issuing State of any adverse action against their driving privileges while the licence is valid.",
      "Confirm the driver’s licence remains valid for commercial driving throughout.",
    ],
    documentation: ["Written guidance from the licensing agencies"],
    deadline: { description: "Before the move." },
    retention: [DQ_FILE],
    exceptions: "—",
    verification: "Agency guidance is on file.",
    ...review,
    verificationNote: "The non-domiciled CDL provisions (§§ 383.23(b), 383.71(f)) were read only in outline, and FMCSA has been revising them. Confirm the current rules with the State licensing agency.",
  },
  {
    ...fed,
    id: "FED-391.11-NON-CDL-DRIVER-LICENSE",
    stage: "Transfer the licence",
    title: "Non-CDL commercial driver: keep one valid licence, and follow the new State’s rules",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("391.11", "49 CFR 391.11(b)(5)")],
    appliesWhen: { fact: "cdlHolder", isFalse: true },
    purpose: "The federal 30-day transfer rule is a CDL rule. A driver of lighter commercial vehicles is still required to hold a valid licence.",
    applicability: "Applies because the driver does not hold a CDL.",
    requiredAction: [
      "A driver of a commercial motor vehicle must have a currently valid commercial motor vehicle operator’s licence issued by only one State or jurisdiction.",
      "When and how an ordinary driver’s licence must be transferred is set by the new State — see the State item — and the driver must not end up holding licences from both States.",
      "Get a copy of the new licence when it is issued.",
    ],
    documentation: ["Copy of the new licence"],
    deadline: { description: "As the new State requires." },
    retention: [DQ_FILE],
    exceptions: "None stated.",
    verification: "One valid licence is on file at all times.",
  },

  // ───────────────────────── Medical certification ─────────────────────────
  {
    ...fed,
    id: "FED-391.51-MEDICAL-STATUS-ON-NEW-RECORD",
    stage: "Medical certification",
    title: "Verify medical certification on the new State’s driving record",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("391.51", "49 CFR 391.51(b)(6)(ii)"), ecfr("391.23", "49 CFR 391.23(m)(2)"), ecfr("383.71", "49 CFR 383.71(c)(1), (h)")],
    appliesWhen: DOMICILED_CDL,
    purpose: "For a CDL holder the proof of medical certification is the driving record from the current licensing State — which is about to change.",
    applicability: "Applies because a CDL holder is changing licensing State.",
    requiredAction: [
      "On transfer the driver self-certifies again the type of driving they do (interstate or intrastate, excepted or non-excepted).",
      "Once the new CDL is issued, obtain the CDLIS motor vehicle record from the new licensing State and confirm it shows the driver’s self-certification and, for non-excepted interstate driving, a current medical certification.",
      "If the new record shows “not-certified” or no medical status, treat the driver as not medically verified until it is corrected — use the medical certificate workflow.",
      "File the new record in the driver qualification file.",
    ],
    documentation: ["CDLIS MVR from the new State showing medical certification status"],
    deadline: { description: "As soon as the new CDL is issued." },
    retention: [{ record: "CDLIS MVR obtained for medical certification", period: "May be removed three years after the date of execution", citation: "49 CFR 391.51(d)(3)" }, DQ_FILE],
    exceptions: "Since June 23, 2025 medical examination results are transmitted electronically; a paper certificate is not proof for a CDL holder.",
    verification: "New State’s MVR is on file and shows “certified” with a future expiration date.",
  },
  {
    ...fed,
    id: "FED-391.41-VARIANCE-AFTER-MOVE",
    stage: "Medical certification",
    title: "Medical variance: make sure it follows the driver",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("391.41", "49 CFR 391.41(a)(1)(ii), (a)(2)(iii)"), ecfr("391.51", "49 CFR 391.51(b)(7)")],
    appliesWhen: { fact: "medicalVariance", isTrue: true },
    purpose: "A driver qualified under an exemption or Skill Performance Evaluation certificate must carry it and the record must reflect it.",
    applicability: "Applies because the driver’s qualification relies on a medical variance.",
    requiredAction: [
      "The driver must keep the original or a copy of the variance document in their possession whenever on duty.",
      "Check that the new State’s driving record reflects the variance, and that the variance’s own expiry date is unaffected by the move.",
      "Keep the variance document in the driver qualification file.",
    ],
    documentation: ["Current variance document", "New State’s MVR"],
    deadline: { description: "When the new licence is issued." },
    retention: [{ record: "Medical variance documentation", period: "May be removed three years after the date of execution", citation: "49 CFR 391.51(d)(4)" }],
    exceptions: "None stated.",
    verification: "Variance is current, on file and carried by the driver.",
  },

  // ───────────────────────── Employer records ─────────────────────────
  {
    ...fed,
    id: "FED-391.25-RECORDS-FROM-BOTH-STATES",
    stage: "Employer records",
    title: "The next annual driving-record inquiry must cover both States",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    sources: [ecfr("391.25", "49 CFR 391.25(a), (c)")],
    appliesWhen: { always: true },
    purpose: "The annual inquiry goes to every licensing authority where the driver held a licence during the period reviewed.",
    applicability: "Every driver who has changed licensing State since the last annual inquiry.",
    requiredAction: [
      "At least once every 12 months, request the motor vehicle record from each licensing authority where the driver held a commercial motor vehicle operator’s licence or permit during that period. For the first inquiry after the move that means both the old State and the new one.",
      "Keep both records in the driver qualification file with the note of the annual review.",
      "Pulling the new State’s record as soon as the licence is issued is a sensible way to confirm the transfer went through cleanly.",
    ],
    documentation: ["MVR from the old State", "MVR from the new State", "Annual review note"],
    deadline: { description: "At the next annual inquiry (at least once every 12 months)." },
    retention: [{ record: "Annual MVR and review note", period: "May be removed three years after the date of execution", citation: "49 CFR 391.51(d)(1), (d)(2)" }],
    exceptions: "Subpart G of Part 391 contains limited exemptions.",
    verification: "The next annual inquiry includes both States.",
  },
  {
    ...company,
    id: "BP-RELOCATION-UPDATE-COMPANY-RECORDS",
    stage: "Employer records",
    title: "Update the driver’s details everywhere they are used",
    kind: "BEST_PRACTICE",
    sources: [ecfr("391.51", "49 CFR 391.51 (context)")],
    appliesWhen: { always: true },
    purpose: "The licence number and issuing State appear in several systems, and a mismatch shows up at the roadside or in an audit.",
    applicability: "Recommended for every relocation.",
    requiredAction: [
      "Update the driver’s address, licence number and issuing State in the driver qualification file, the ELD driver profile and your drug and alcohol testing records.",
      "Ask the driver to update the licence details in their own Drug and Alcohol Clearinghouse account.",
      "Tell your insurer, and update payroll and tax records for the new State of residence.",
    ],
    documentation: ["Updated driver profile", "Confirmation from the insurer"],
    deadline: { description: "When the new licence is issued." },
    retention: [{ record: "Updated records", period: "Company policy" }],
    exceptions: "Not a regulatory requirement as stated here. Payroll and tax consequences of a change of residence are State and federal employment-law matters outside this workflow.",
    verification: "Licence number matches across the file, the ELD and the testing records.",
  },

  // ───────────────────────── State procedure ─────────────────────────
  {
    ...fed,
    id: "STATE-NEW-STATE-LICENSING-PROCEDURE",
    stage: "State requirements",
    title: "The new State’s licensing procedure, fees, tests and its own deadlines",
    kind: "LEGAL",
    authority: "State driver licensing agency",
    jurisdiction: "STATE",
    commerceScope: "NOT_COMMERCE_BASED",
    stateDependent: { stateFact: "toState", topic: "licence transfer for new residents" },
    sources: [{ citation: "State law (varies)", url: "https://www.fmcsa.dot.gov/registration/commercial-drivers-license" }],
    appliesWhen: { always: true },
    purpose: "Each State sets how a new resident transfers a licence: what documents it accepts, whether any test is repeated, the fees, and — for an ordinary licence and for vehicle registration — its own deadline, which may be shorter than 30 days.",
    applicability: "Depends on the State the driver is moving to.",
    requiredAction: [
      "Have the driver check the new State’s official driver licensing agency for: the documents accepted as proof of identity and residency; whether an appointment is needed; whether any knowledge, skills or vision test is repeated; the fees; and how long issuance takes.",
      "Ask whether the State has its own deadline for new residents to obtain a licence or register a personal vehicle.",
      "Ask whether the State issues a temporary licence and whether it is valid for commercial driving.",
    ],
    documentation: ["Printout or link from the State agency’s official site", "Receipt from the licensing office"],
    deadline: { description: "State-specific. The federal outer limit for a CDL transfer application is 30 days from establishing domicile." },
    retention: [DQ_FILE],
    exceptions: "—",
    verification: "Information is taken from the State agency’s own website or office, not from a third party.",
    ...review,
    verificationNote: "No state rule pack is loaded. FleetComply does not know any State’s documents, fees, tests or deadlines and does not state them.",
  },
];
