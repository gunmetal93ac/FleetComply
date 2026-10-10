import type { RegulatoryRule } from "../types";
import { ecfr } from "./util";

/**
 * Federal rule catalog — "Driver selected for random testing is unavailable" (catalog 2026.10.2).
 *
 * Facts (from the random-test workflow's derive() step):
 *   reason   — "ON_THE_ROAD" | "SHORT_ABSENCE" | "LONG_ABSENCE" | "NO_SHOW" | "LEFT_COMPANY"
 *   testType — "DRUG" | "ALCOHOL" | "BOTH"
 *
 * Verification: § 382.305 and § 382.705 checked on 2026-10-09 against a paragraph-level
 * extraction of the eCFR text current through 2026-10-05. § 382.305 states no rule for a
 * selected driver who is unavailable; items that rest on FMCSA guidance or on 49 CFR Part 40
 * are flagged for review.
 */

const V = "2026-10-09";
const initial = [{ version: 1, date: V, note: "Initial catalog entry; checked against a paragraph-level extraction of the eCFR text current through 2026-10-05." }];

type Common = Pick<RegulatoryRule, "version" | "workflows" | "authority" | "jurisdiction" | "effectiveDate" | "lastVerified" | "verificationStatus" | "changeLog" | "blocksSafetySensitive" | "recordCategory" | "commerceScope">;
const fed: Common = {
  version: 1,
  workflows: ["RANDOM_TEST_SELECTION"],
  authority: "FMCSA",
  jurisdiction: "FEDERAL",
  effectiveDate: "1970-01-01",
  lastVerified: V,
  verificationStatus: "VERIFIED",
  changeLog: initial,
  blocksSafetySensitive: false,
  recordCategory: "DRUG_ALCOHOL_PROGRAM",
  commerceScope: "ALL_COMMERCE",
};
const company: Common = { ...fed, authority: "Company", jurisdiction: "COMPANY", commerceScope: "NOT_COMMERCE_BASED" };
const PROGRAM_RECORDS = { record: "Records related to administering the testing program (including random selection records)", period: "Five years", citation: "49 CFR 382.401(b)(1)" };

export const federalRandomTestingRules: RegulatoryRule[] = [
  {
    ...fed,
    id: "FED-382.305I3-TEST-WITHIN-SELECTION-PERIOD",
    stage: "The rule",
    title: "A selected driver must be tested during the selection period",
    kind: "LEGAL",
    sources: [ecfr("382.305", "49 CFR 382.305(i), (k)")],
    appliesWhen: { always: true },
    purpose: "Random testing only deters use if every driver has an equal chance of being tested and selections are actually completed.",
    applicability: "Every driver selected in a random draw.",
    requiredAction: [
      "Each driver selected for random testing must be tested during the selection period.",
      "Tests must be unannounced, and test dates must be spread reasonably throughout the calendar year — so do not tell the driver in advance that they have been selected.",
      "Record the selection, the date the driver was notified and the date tested (or why not).",
    ],
    documentation: ["Random selection list for the period", "Notification record", "Test result or documented reason the test did not occur"],
    deadline: { description: "Within the selection period (for example the month or quarter of the draw)." },
    retention: [PROGRAM_RECORDS],
    exceptions: "§ 382.305 does not state a rule for a selected driver who is unavailable — see the absence steps below.",
    verification: "Selection list shows a result or a documented reason for every name.",
  },
  {
    ...fed,
    id: "FED-382.305L-NOTIFY-THEN-IMMEDIATELY",
    stage: "Getting the test done",
    title: "Notify the driver only when they can go — then they must go immediately",
    kind: "LEGAL",
    sources: [ecfr("382.305", "49 CFR 382.305(l)")],
    appliesWhen: { fact: "reason", in: ["ON_THE_ROAD", "SHORT_ABSENCE"] },
    purpose: "The time between notification and collection must be as short as possible.",
    applicability: "Applies because the driver is working away from the terminal, or is briefly off and will be back within the selection period.",
    requiredAction: [
      "Hold the notification until the driver can proceed straight to a collection site — on return to duty, or when the driver is near a site on their route.",
      "Once notified, the driver must proceed to the test site immediately. If the driver is performing a safety-sensitive function other than driving a CMV, the employer must ensure the driver stops and proceeds to the site as soon as possible.",
      "For a driver on the road, arrange a collection site near the route through your consortium or third-party administrator before notifying.",
    ],
    documentation: ["Time of notification and time of arrival at the collection site"],
    deadline: { description: "Immediately after notification; within the selection period overall." },
    retention: [PROGRAM_RECORDS],
    exceptions: "None stated.",
    verification: "Notification-to-arrival time is recorded and reasonable for the distance.",
  },
  {
    ...fed,
    id: "FED-382.305M-ALCOHOL-TIMING",
    stage: "Getting the test done",
    title: "Random alcohol test: only around safety-sensitive work",
    kind: "LEGAL",
    sources: [ecfr("382.305", "49 CFR 382.305(m)")],
    appliesWhen: { fact: "testType", in: ["ALCOHOL", "BOTH"] },
    purpose: "Alcohol is only prohibited in connection with safety-sensitive functions, so the test must be tied to them.",
    applicability: "Applies because the selection includes an alcohol test.",
    requiredAction: [
      "A driver may be tested for alcohol only while performing safety-sensitive functions, just before performing them, or just after ceasing to perform them.",
      "Do not call a driver in from a day off, leave or vacation for a random alcohol test — schedule it for a working day inside the selection period.",
    ],
    documentation: ["Record showing the driver was on duty at the time of the alcohol test"],
    deadline: { description: "On a working day within the selection period." },
    retention: [PROGRAM_RECORDS],
    exceptions: "This timing limit is stated for alcohol tests; § 382.305 does not state it for controlled substances tests.",
    verification: "Duty records show the driver was working when tested.",
  },
  {
    ...fed,
    id: "REVIEW-RANDOM-LONG-ABSENCE",
    stage: "If the test cannot be done",
    title: "Driver will be away for the whole selection period",
    kind: "LEGAL",
    sources: [ecfr("382.305", "49 CFR 382.305(i)(3), (j)(1)")],
    appliesWhen: { fact: "reason", eq: "LONG_ABSENCE" },
    purpose: "The regulation says a selected driver must be tested during the selection period and gives no exception for absence, so a missed selection needs a documented, defensible reason.",
    applicability: "Applies because the driver will not return to work before the selection period ends.",
    requiredAction: [
      "Document why the driver cannot be tested in the period (medical leave, layoff, extended vacation) with dates.",
      "Do not replace the driver with a hand-picked substitute. If your programme uses alternates, they must come from the same random draw.",
      "Check whether the driver should still be in the pool: only covered drivers may be in it, and all covered drivers must be.",
      "Make sure the company still meets the minimum annual testing rate for the year.",
      "When the driver returns, check whether a pre-employment test is required before they resume safety-sensitive work.",
    ],
    documentation: ["Absence dates and reason", "Programme record of the unfilled selection"],
    deadline: { description: "Before the selection period closes." },
    retention: [PROGRAM_RECORDS],
    exceptions: "FMCSA has published guidance on selected drivers who are unavailable (including when a selection may be skipped). It is not in the regulation text.",
    verification: "Unfilled selection is documented and the annual rate is still on track.",
    lastVerified: null,
    verificationStatus: "REQUIRES_VERIFICATION",
    verificationNote: "§ 382.305 has no provision for an unavailable driver. FMCSA’s interpretive guidance on skipping or deferring a selection, and the § 382.301 pre-employment test rules for returning drivers, were not read for this release.",
  },
  {
    ...fed,
    id: "REVIEW-RANDOM-NO-SHOW",
    stage: "If the test cannot be done",
    title: "Driver was notified and did not go: decide whether it is a refusal",
    kind: "LEGAL",
    sources: [ecfr("382.705", "49 CFR 382.705(b)(1)(iii), (b)(1)(iv), (b)(3)"), ecfr("382.305", "49 CFR 382.305(l)")],
    appliesWhen: { fact: "reason", eq: "NO_SHOW" },
    purpose: "Failing to appear for a test after being directed to can be a refusal to test — a violation with the same consequences as a positive result.",
    applicability: "Applies because the driver was told to report for the test and did not.",
    requiredAction: [
      "Establish the facts: exactly when and how the driver was notified, what they were told (date, time, location), and what they did.",
      "Have the designated employer representative decide whether the conduct is a refusal under 49 CFR 40.191 (drug) or 40.261 (alcohol).",
      "If it is a refusal: remove the driver from safety-sensitive functions, and report it to the Clearinghouse by the close of the third business day following the date you obtained the information. The report must include documentation such as proof the driver was notified to appear (date, time and location) or an affidavit, proof of the termination or resignation date if applicable, and proof the driver received the documentation.",
      "Then follow the “positive test, refusal or other drug/alcohol violation” workflow.",
    ],
    documentation: ["Proof of notification (date, time, location) or affidavit", "DER’s written refusal determination", "Clearinghouse report confirmation"],
    deadline: { description: "If a refusal: Clearinghouse report by the close of the third business day after obtaining the information." },
    retention: [{ record: "Documentation of refusals", period: "Five years", citation: "49 CFR 382.401(b)(1)" }],
    exceptions: "A driver who was never actually notified has not refused. A driver who quits rather than test should still be evaluated under the refusal rules.",
    verification: "Written determination is on file; if a refusal, the Clearinghouse report is dated inside the deadline.",
    lastVerified: null,
    verificationStatus: "REQUIRES_VERIFICATION",
    verificationNote: "The reporting duty and required documentation are from § 382.705 (checked). What counts as a refusal is defined in 49 CFR 40.191 and 40.261, which were not read for this release.",
    warning: "Do not allow the driver to perform safety-sensitive functions while a possible refusal is unresolved without a documented decision by the designated employer representative.",
  },
  {
    ...company,
    id: "BP-RANDOM-LEFT-COMPANY",
    stage: "If the test cannot be done",
    title: "Driver no longer works for the company",
    kind: "BEST_PRACTICE",
    sources: [ecfr("382.305", "49 CFR 382.305(j)(1) (only covered drivers may be in the pool — context)")],
    appliesWhen: { fact: "reason", eq: "LEFT_COMPANY" },
    purpose: "A person who is no longer a covered driver cannot be tested, but the selection record should show why.",
    applicability: "Applies because the driver left before the test.",
    requiredAction: [
      "Record the separation date against the selection and remove the driver from the pool.",
      "If the driver left after being notified and without testing, treat it as a possible refusal and work through the no-show step instead.",
      "Use the “Driver leaves the company” workflow for the records you must keep.",
    ],
    documentation: ["Separation date noted on the selection record"],
    deadline: { description: "When the selection is closed out." },
    retention: [PROGRAM_RECORDS],
    exceptions: "—",
    verification: "Selection record shows the separation date; pool is updated.",
  },
  {
    ...fed,
    id: "FED-382.305B-ANNUAL-RATE",
    stage: "Keep the programme compliant",
    title: "Make sure the year’s random testing rates are still met",
    kind: "LEGAL",
    sources: [ecfr("382.305", "49 CFR 382.305(b)–(h), (j)")],
    appliesWhen: { always: true },
    purpose: "Missed selections count against the minimum number of tests the company must complete each year.",
    applicability: "Every employer with drivers subject to random testing.",
    requiredAction: [
      "The regulation sets the minimum annual rates at 50 percent of the average number of driver positions for controlled substances and 10 percent for alcohol, and allows the FMCSA Administrator to raise or lower them by notice in the Federal Register, effective January 1 of the following year. Confirm the rate in force for the current calendar year.",
      "Compare tests completed so far with the number needed, and adjust the remaining draws so the year ends at or above the minimum.",
      "If you are in a consortium or third-party pool, the employer must ensure the pool is tested at the correct rate and contains only covered employees.",
    ],
    documentation: ["Year-to-date random testing summary", "Published rate for the current year"],
    deadline: { description: "By December 31 of each calendar year." },
    retention: [PROGRAM_RECORDS],
    exceptions: "A driver subject to more than one DOT agency’s testing is tested at the rate of the agency regulating more than 50 percent of their functions.",
    verification: "Year-to-date summary shows completed tests at or above the required pace.",
    verificationNote: "The rates quoted are those printed in § 382.305(b). The rate currently in force by Federal Register notice was not checked for this release.",
  },
];
