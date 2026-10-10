import type { Condition, RegulatoryRule } from "../types";
import { ecfr } from "./util";

/**
 * Federal rule catalog — "A driver leaves the company" (quits, is terminated or laid off).
 *
 * Facts (from the separation workflow's derive() step):
 *   cdlDriver       — boolean: was the driver subject to DOT drug & alcohol testing
 *   openViolation   — "YES" | "NO" | "UNKNOWN": unresolved violation, unreported event,
 *                     or unfinished follow-up testing plan
 *   operationType / operatingState — drive the interstate-only logic in the engine
 *   companyState    — for state employment-law items
 *
 * Verification: checked on 2026-10-09 against a paragraph-level extraction of the
 * eCFR text current through 2026-10-05.
 */

const V = "2026-10-09";
const initial = [{ version: 1, date: V, note: "Initial catalog entry; checked against a paragraph-level extraction of the eCFR text current through 2026-10-05." }];

type Common = Pick<RegulatoryRule, "version" | "workflows" | "authority" | "jurisdiction" | "effectiveDate" | "lastVerified" | "verificationStatus" | "changeLog" | "blocksSafetySensitive">;
const fed: Common = {
  version: 1,
  workflows: ["DRIVER_SEPARATION"],
  authority: "FMCSA",
  jurisdiction: "FEDERAL",
  effectiveDate: "1970-01-01",
  lastVerified: V,
  verificationStatus: "VERIFIED",
  changeLog: initial,
  blocksSafetySensitive: false,
};
const company: Common = { ...fed, authority: "Company", jurisdiction: "COMPANY" };

const CDL_DRIVER: Condition = { fact: "cdlDriver", isTrue: true };
const OPEN_VIOLATION: Condition = { all: [CDL_DRIVER, { fact: "openViolation", eq: "YES" }] };

export const federalSeparationRules: RegulatoryRule[] = [
  // ───────────────────────── At separation ─────────────────────────
  {
    ...company,
    id: "BP-SEP-CLOSE-OUT",
    stage: "At separation",
    title: "Close out the driver’s access and active programs",
    kind: "BEST_PRACTICE",
    commerceScope: "NOT_COMMERCE_BASED",
    recordCategory: "COMPANY_RECORDS",
    sources: [ecfr("391.51", "49 CFR 391.51(c) (records must survive the separation — context)")],
    appliesWhen: { always: true },
    purpose: "A clean hand-off prevents a former driver being dispatched, tested or logged by mistake, and makes sure the records you must keep are complete on the last day.",
    applicability: "Recommended for every separation.",
    requiredAction: [
      "Record the separation date and reason.",
      "Collect the driver’s final records of duty status and any outstanding inspection reports or paperwork.",
      "Deactivate the driver’s ELD login without deleting their data; resolve any unassigned driving time that belongs to them.",
      "Remove the driver from the random drug and alcohol testing pool as of the separation date.",
      "Recover company equipment, fuel cards and credentials.",
    ],
    documentation: ["Separation record with date and reason", "Final logs and paperwork"],
    deadline: { description: "On or shortly after the last day." },
    retention: [{ record: "Separation record", period: "Company policy" }],
    exceptions: "Not a regulatory requirement.",
    verification: "Checklist completed and signed by the safety manager.",
  },
  {
    ...fed,
    id: "FED-382.705-REPORT-BEFORE-CLOSING",
    stage: "At separation",
    title: "Report any outstanding drug or alcohol event to the Clearinghouse",
    kind: "LEGAL",
    commerceScope: "ALL_COMMERCE",
    recordCategory: "DRUG_ALCOHOL_PROGRAM",
    sources: [ecfr("382.705", "49 CFR 382.705(b)(1), (b)(3), (b)(4)")],
    appliesWhen: OPEN_VIOLATION,
    purpose: "The duty to report runs from when the employer obtained the information. A driver quitting or being fired does not cancel it.",
    applicability: "Applies because the driver has an unresolved violation, an unreported event, or an unfinished follow-up testing plan.",
    requiredAction: [
      "Report to the Clearinghouse, by the close of the third business day following the date you obtained the information, any of: an alcohol confirmation test of 0.04 or greater; a refusal to take an alcohol test; a refusal-to-test determination for a drug test; a negative return-to-duty test; and a report that the driver has completed all follow-up tests.",
      "Report actual-knowledge violations (on-duty or pre-duty alcohol use, alcohol use following an accident, controlled substance use) by the close of the third business day following the date you obtained actual knowledge.",
      "For a refusal based on failing to appear for a test, the report includes documentation such as proof the driver was notified to appear and proof of the termination or resignation date, if applicable. A driver who resigns instead of testing should be evaluated under the refusal rules — use the drug/alcohol violation workflow.",
    ],
    documentation: ["Clearinghouse report confirmation", "Supporting documents: notice to appear, termination/resignation date, proof the driver received the documentation"],
    deadline: { description: "By the close of the third business day following the date the information was obtained." },
    retention: [{ record: "Records of driver violations and refusals", period: "Five years", citation: "49 CFR 382.401(b)(1)" }],
    exceptions: "MRO-verified positive drug tests are reported by the MRO, not the employer.",
    verification: "Clearinghouse shows the report with a submission date inside the deadline.",
  },

  // ───────────────────────── Keep the records ─────────────────────────
  {
    ...fed,
    id: "FED-391.51C-KEEP-DQ-FILE",
    stage: "Keep the records",
    title: "Keep the driver qualification file for 3 years after the driver leaves",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    recordCategory: "DRIVER_QUALIFICATION_FILE",
    sources: [ecfr("391.51", "49 CFR 391.51(c), (d)")],
    appliesWhen: { always: true },
    purpose: "Investigators and later employers may ask about a former driver long after they have gone.",
    applicability: "Every driver for whom a qualification file was kept.",
    requiredAction: [
      "Retain the driver qualification file for as long as the driver is employed and for three years thereafter.",
      "Do not purge the file at separation. The only items that may be removed earlier are those listed in § 391.51(d), three years after their own date of execution: annual MVRs, annual review notes, medical certificates / CDLIS MVRs, medical variances, and National Registry verification notes.",
      "Mark the file with the separation date and the earliest destruction date.",
    ],
    documentation: ["Complete driver qualification file, marked with the separation date"],
    deadline: { description: "Keep for three years after the separation date." },
    retention: [{ record: "Driver qualification file", period: "For as long as the driver is employed and for three years thereafter", citation: "49 CFR 391.51(c)" }],
    exceptions: "Items listed in § 391.51(d) may be removed three years after their date of execution.",
    verification: "File is in inactive storage with a destruction date no earlier than three years after separation.",
  },
  {
    ...fed,
    id: "FED-391.53C-KEEP-INVESTIGATION-FILE",
    stage: "Keep the records",
    title: "Keep the driver investigation history file — secured — for 3 years",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    recordCategory: "DRIVER_INVESTIGATION_HISTORY_FILE",
    sources: [ecfr("391.53", "49 CFR 391.53(a), (c)")],
    appliesWhen: { always: true },
    purpose: "The safety performance history you collected when hiring the driver is confidential and has its own retention rule.",
    applicability: "Every hired driver for whom a safety performance history investigation was made.",
    requiredAction: [
      "Retain the driver investigation history file for as long as the driver is employed and for three years thereafter.",
      "Keep it in a secure location with controlled access, limited to people involved in the hiring decision or who control access to the data.",
    ],
    documentation: ["Driver investigation history file"],
    deadline: { description: "Keep for three years after the separation date." },
    retention: [{ record: "Driver investigation history file", period: "For as long as the driver is employed and for three years thereafter", citation: "49 CFR 391.53(c)" }],
    exceptions: "None stated.",
    verification: "File is stored separately with access restricted.",
  },
  {
    ...fed,
    id: "FED-382.401-KEEP-DA-RECORDS",
    stage: "Keep the records",
    title: "Keep drug and alcohol testing records for their full periods",
    kind: "LEGAL",
    commerceScope: "ALL_COMMERCE",
    recordCategory: "DRUG_ALCOHOL_PROGRAM",
    sources: [ecfr("382.401", "49 CFR 382.401(a), (b), (d)")],
    appliesWhen: CDL_DRIVER,
    purpose: "Testing records have fixed retention periods that run regardless of whether the driver still works for you.",
    applicability: "Applies because the driver was subject to DOT drug and alcohol testing.",
    requiredAction: [
      "Five years: alcohol test results of 0.02 or greater; verified positive drug test results; documentation of refusals; driver evaluations and referrals; records related to administering the testing program, including all driver violations.",
      "Two years: records of the alcohol and controlled substances collection process.",
      "One year: negative and cancelled drug test results, and alcohol test results below 0.02.",
      "Keep the records in a secure location with controlled access, and be able to produce them at the principal place of business within two business days of a request by an authorized FMCSA representative.",
    ],
    documentation: ["Driver’s drug and alcohol testing records, sorted by retention period"],
    deadline: { description: "Each period runs from the date of the record." },
    retention: [
      { record: "Positives, alcohol ≥ 0.02, refusals, evaluations/referrals, violation records", period: "Five years", citation: "49 CFR 382.401(b)(1)" },
      { record: "Collection process records", period: "Two years", citation: "49 CFR 382.401(b)(2)" },
      { record: "Negative and cancelled drug results; alcohol results below 0.02", period: "One year", citation: "49 CFR 382.401(b)(3)" },
    ],
    exceptions: "Training records are kept while the individual performs the functions and for two years after (382.401(b)(4)).",
    verification: "Records are in controlled-access storage with destruction dates set per category.",
  },
  {
    ...fed,
    id: "FED-395.8K-KEEP-LOGS",
    stage: "Keep the records",
    title: "Keep the driver’s logs and supporting documents for 6 months",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    recordCategory: "COMPANY_RECORDS",
    sources: [ecfr("395.8", "49 CFR 395.8(k)(1)"), ecfr("395.30", "49 CFR 395.30(f)")],
    appliesWhen: { always: true },
    purpose: "Hours-of-service records must outlast the driver’s employment.",
    applicability: "Every driver who kept records of duty status.",
    requiredAction: [
      "Retain records of duty status and supporting documents for not less than 6 months from the date of receipt.",
      "Do not alter or erase the original ELD hours-of-service data when closing the driver’s account.",
    ],
    documentation: ["Records of duty status and supporting documents for the last 6 months"],
    deadline: { description: "Six months from the date each record was received." },
    retention: [{ record: "Records of duty status and supporting documents", period: "Not less than 6 months from the date of receipt", citation: "49 CFR 395.8(k)(1)" }],
    exceptions: "None stated.",
    verification: "ELD data and supporting documents for the period can still be produced.",
  },

  // ───────────────────────── After the driver has left ─────────────────────────
  {
    ...fed,
    id: "FED-391.23G-ANSWER-HISTORY-REQUESTS",
    stage: "After the driver has left",
    title: "Answer safety performance history requests within 30 days",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    recordCategory: "DRIVER_INVESTIGATION_HISTORY_FILE",
    sources: [ecfr("391.23", "49 CFR 391.23(g), (h), (j)")],
    appliesWhen: { always: true },
    purpose: "The driver’s next employer must investigate their history, and you are required to respond.",
    applicability: "Every previous employer that receives an investigation request about a former driver.",
    requiredAction: [
      "Respond to each request within 30 days after it is received. If you hold no data, send a response confirming that.",
      "Take all precautions reasonably necessary to ensure the records are accurate, and provide specific contact information in case the driver wants to seek correction or rebuttal.",
      "Release the information in a way that reasonably ensures confidentiality (letter, fax or e-mail are acceptable).",
      "Keep a record of each request and the response for one year, including the date, the party the information was released to, and a summary of what was provided.",
      "If the driver asks you to correct the data: either correct it and forward it to the prospective employer, or notify the driver within 15 days that you will not. If the driver submits a rebuttal, forward a copy to the prospective employer within five business days and append it to the driver’s file.",
    ],
    documentation: ["Log of each request and response (date, recipient, summary)", "Correction and rebuttal correspondence"],
    deadline: { description: "Within 30 days after each request is received." },
    retention: [{ record: "Record of each request and response", period: "One year", citation: "49 CFR 391.23(g)(4)" }],
    exceptions: "Drug and alcohol history for FMCSA-regulated employment is now obtained by the new employer from the Clearinghouse (391.23(e)(4), as of January 6, 2023).",
    verification: "Each request in the log shows a response date within 30 days.",
  },
  {
    ...fed,
    id: "FED-391.23E4-FOLLOW-UP-PLAN",
    stage: "After the driver has left",
    title: "Be ready to give the next employer the follow-up testing plan",
    kind: "LEGAL",
    commerceScope: "INTERSTATE_ONLY",
    recordCategory: "DRUG_ALCOHOL_PROGRAM",
    sources: [ecfr("391.23", "49 CFR 391.23(e)(4)(i), (g)"), ecfr("382.705", "49 CFR 382.705(b)(1)(v)")],
    appliesWhen: OPEN_VIOLATION,
    purpose: "A driver who leaves part-way through follow-up testing still owes the remaining tests; the next employer needs the plan to continue it.",
    applicability: "Applies because the driver left with an unfinished follow-up testing plan or unresolved violation.",
    requiredAction: [
      "For an applicant who has not completed follow-up testing, the new employer must request the follow-up testing plan directly from the previous employer. Respond to that request as you would any safety performance history request.",
      "Keep the SAP’s follow-up testing plan and the record of tests completed so far where they can be found.",
      "Do not report follow-up testing as completed — only an employer for whom the driver actually finishes all prescribed tests reports that.",
    ],
    documentation: ["SAP follow-up testing plan", "Record of follow-up tests completed before separation"],
    deadline: { description: "Within 30 days after a request is received." },
    retention: [{ record: "Driver evaluation and referral records", period: "Five years", citation: "49 CFR 382.401(b)(1)" }],
    exceptions: "None stated.",
    verification: "Plan and test record are filed with the driver’s drug and alcohol records.",
  },
  {
    ...fed,
    id: "STATE-SEP-EMPLOYMENT-LAW",
    stage: "At separation",
    title: "State employment requirements: final pay and separation notices",
    kind: "LEGAL",
    authority: "State labor agency",
    jurisdiction: "STATE",
    commerceScope: "NOT_COMMERCE_BASED",
    recordCategory: "GENERAL_EMPLOYMENT",
    stateDependent: { stateFact: "companyState", topic: "employee separation" },
    sources: [{ citation: "State law (varies)", url: "https://www.dol.gov/agencies/whd/state" }],
    appliesWhen: { always: true },
    purpose: "Final-pay timing, payout of accrued leave and required separation notices are set by State law, not by the transportation regulations.",
    applicability: "Depends on the State where the driver was employed.",
    requiredAction: ["Confirm the State’s deadline for the final paycheck and any required separation or unemployment notice.", "Keep these records with the personnel file, separate from the driver qualification file."],
    documentation: ["Final pay record", "Separation notice, if required"],
    deadline: { description: "State-specific." },
    retention: [{ record: "Payroll and separation records", period: "Per State and federal employment law" }],
    exceptions: "—",
    verification: "Confirmed with the State labor agency or counsel.",
    lastVerified: null,
    verificationStatus: "REQUIRES_VERIFICATION",
    verificationNote: "State-specific and outside Title 49; state rule packs are not loaded.",
  },
];
