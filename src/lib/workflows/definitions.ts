import type { Facts, WorkflowKey } from "../rules/types";
import { JURISDICTIONS } from "../rules/state-registry";

export type QuestionType = "state" | "select" | "boolean" | "date" | "datetime" | "text";

export interface Question {
  id: string;
  label: string;
  help?: string;
  type: QuestionType;
  options?: Array<{ value: string; label: string }>;
  required: boolean;
  /** Only shown (and only validated) when this returns true for the current answers. */
  showIf?: (a: Answers) => boolean;
}

export type Answers = Record<string, string | boolean | undefined>;

export interface OrgSettings {
  baseState?: string | null;
  preEmploymentAlcoholTesting: boolean;
}

export interface WorkflowDefinition {
  key: WorkflowKey;
  title: string;
  description: string;
  /**
   * Does this workflow attach to an existing driver, or create one? "optional" is for situations
   * about the company or a vehicle: a driver can be linked but none is required.
   */
  driver: "create" | "existing" | "optional";
  questions: Question[];
  /** Field-level validation. Returns { questionId: message }. */
  validate(a: Answers): Record<string, string>;
  /** Turn answers + org settings into engine facts. */
  derive(a: Answers, org: OrgSettings): Facts;
  /** Situation-level warnings shown above the checklist. */
  warnings(a: Answers, facts: Facts): string[];
}

const YNU = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
  { value: "UNKNOWN", label: "Not sure yet" },
];
const STATE_OPTIONS = JURISDICTIONS.map(([value, label]) => ({ value, label }));

function visible(q: Question, a: Answers) {
  return !q.showIf || q.showIf(a);
}

/** Shared validator: required visible questions; option membership; date parse. */
export function validateAnswers(questions: Question[], a: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of questions) {
    if (!visible(q, a)) continue;
    const v = a[q.id];
    const empty = v === undefined || v === "";
    if (empty) {
      if (q.required) errors[q.id] = "Required";
      continue;
    }
    if (q.type === "boolean" && typeof v !== "boolean") errors[q.id] = "Choose Yes or No";
    if ((q.type === "select" || q.type === "state") && q.options && !q.options.some((o) => o.value === v))
      errors[q.id] = "Choose one of the listed options";
    if ((q.type === "date" || q.type === "datetime") && Number.isNaN(new Date(String(v)).getTime()))
      errors[q.id] = "Enter a valid date";
  }
  return errors;
}

export function visibleQuestions(def: WorkflowDefinition, a: Answers): Question[] {
  return def.questions.filter((q) => visible(q, a));
}

// ─────────────────────────────── Hire a new CDL driver ───────────────────────────────

const hireQuestions: Question[] = [
  { id: "companyState", label: "In which state is the company based?", type: "state", options: STATE_OPTIONS, required: true },
  { id: "licenseState", label: "In which state is the driver licensed?", type: "state", options: STATE_OPTIONS, required: true },
  { id: "operatingState", label: "In which state will the driver primarily operate?", type: "state", options: STATE_OPTIONS, required: true },
  {
    id: "operationType",
    label: "Will the driver operate interstate or only intrastate?",
    help: "Interstate includes trips that cross state lines and intrastate legs of a shipment that is moving interstate. If unsure, choose 'Not sure'.",
    type: "select",
    options: [
      { value: "INTERSTATE", label: "Interstate (or both)" },
      { value: "INTRASTATE", label: "Intrastate only" },
      { value: "UNKNOWN", label: "Not sure" },
    ],
    required: true,
  },
  {
    id: "cdlVehicle",
    label: "Will the driver operate a vehicle that requires a CDL?",
    help: "This workflow covers CDL positions. Non-CDL hiring is a separate (planned) workflow.",
    type: "boolean",
    required: true,
  },
  {
    id: "cdlClass",
    label: "What CDL class does the driver hold?",
    type: "select",
    options: [
      { value: "A", label: "Class A" },
      { value: "B", label: "Class B" },
      { value: "C", label: "Class C" },
    ],
    required: true,
  },
  { id: "hazmat", label: "Will the driver transport hazardous materials?", type: "boolean", required: true },
  { id: "passengers", label: "Will the driver transport passengers?", type: "boolean", required: true },
  {
    id: "tankOrDoublesAssignment",
    label: "Will the driver be assigned tank vehicles or double/triple trailers?",
    help: "A CDL cannot be accepted in place of a road test for these assignments.",
    type: "select",
    options: [
      { value: "YES", label: "Yes" },
      { value: "NO", label: "No" },
    ],
    required: true,
  },
  {
    id: "dotTesting",
    label: "Is the position subject to DOT drug and alcohol testing?",
    help: "Every driver of a CDL-required vehicle is covered by 49 CFR Part 382. FleetComply checks your answer against that.",
    type: "select",
    options: YNU,
    required: true,
  },
  {
    id: "experience",
    label: "Is the driver newly licensed, experienced, or returning to employment?",
    type: "select",
    options: [
      { value: "NEW_LICENSE", label: "Newly licensed (less than 1 year)" },
      { value: "EXPERIENCED", label: "Experienced" },
      { value: "RETURNING", label: "Returning to driving after time away" },
    ],
    required: true,
  },
  {
    id: "priorDotEmployment",
    label: "Did the driver work for any DOT-regulated employer in the last 3 years?",
    type: "select",
    options: YNU,
    required: true,
  },
  {
    id: "nonFmcsaDotEmployer",
    label: "Was any of that employment tested under another DOT agency (FAA, FTA, FRA, PHMSA, USCG)?",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.priorDotEmployment === "YES",
  },
  {
    id: "priorViolation",
    label: "Does the driver have any prior DOT drug or alcohol violation?",
    help: "If unknown, the Clearinghouse query will tell you — answer 'Not sure yet' and update the run afterwards.",
    type: "select",
    options: YNU,
    required: true,
  },
  {
    id: "preEmploymentTestException",
    label: "Will you rely on the 382.301(b) exception instead of a pre-employment drug test?",
    help: "Most carriers test. The exception requires specific proof from the driver's previous testing program.",
    type: "select",
    options: [
      { value: "NO", label: "No — we will test" },
      { value: "YES", label: "Yes — we will document the exception" },
    ],
    required: true,
  },
  {
    id: "exemption",
    label: "Will the driver operate under any regulatory exemption?",
    type: "select",
    options: [
      { value: "NONE", label: "No exemption" },
      { value: "CLAIMED", label: "Possibly — an exemption may apply" },
    ],
    required: true,
  },
  { id: "employmentStartDate", label: "Planned employment start date", type: "date", required: true },
];

export const hireCdlDriver: WorkflowDefinition = {
  key: "HIRE_CDL_DRIVER",
  title: "Hire a new CDL driver",
  description: "Qualification file, investigations, drug & alcohol requirements and HR paperwork — personalized to the driver and operation.",
  driver: "create",
  questions: hireQuestions,
  validate(a) {
    const errors = validateAnswers(hireQuestions, a);
    if (a.cdlVehicle === false)
      errors.cdlVehicle = "This workflow is for CDL positions. Use 'Hire a non-CDL commercial driver' (planned) instead.";
    return errors;
  },
  derive(a, org) {
    return {
      ...a,
      companyAlcoholPreEmploymentPolicy: org.preEmploymentAlcoholTesting,
      // Part 382 covers every driver of a CDL-required vehicle regardless of the answer given.
      subjectToPart382: a.cdlVehicle === true,
      nonFmcsaDotEmployer: a.priorDotEmployment === "YES" ? a.nonFmcsaDotEmployer : "NO",
    };
  },
  warnings(a) {
    const w: string[] = [];
    if (a.cdlVehicle === true && a.dotTesting === "NO")
      w.push(
        "You answered that the position is not subject to DOT testing, but drivers of CDL-required vehicles are covered by 49 CFR Part 382 (interstate and intrastate). FleetComply has applied the Part 382 requirements.",
      );
    if (a.operationType === "INTRASTATE")
      w.push(
        "Intrastate-only operation: several federal Part 391 items depend on your state's adopted rules, which FleetComply has not loaded yet. Those items are marked 'Unable to determine' — they are not cleared.",
      );
    if (a.operationType === "UNKNOWN")
      w.push("Interstate vs. intrastate is not settled. Interstate-only items are marked 'Unable to determine' until you update the answer.");
    if (a.passengers === true)
      w.push("Passenger transport: confirm the P (and S, for school buses) endorsement in the CDL item. Passenger-carrier-specific rules are not yet modeled.");
    if (a.experience === "RETURNING")
      w.push(
        "Returning or rehired driver: FleetComply lists every hiring step again, as for a new hire. Where a step’s Exceptions say an earlier record or test can be relied on, check that its conditions are met and that the record is still current before reusing it.",
      );
    return w;
  },
};

// ─────────────────────────────── Accident ───────────────────────────────

const accidentQuestions: Question[] = [
  { id: "accidentAt", label: "When did the accident happen? (date and time)", help: "Testing deadlines count from this moment.", type: "datetime", required: true },
  { id: "accidentState", label: "In which state did it happen?", type: "state", options: STATE_OPTIONS, required: true },
  {
    id: "onlyBoardingOrCargo",
    label: "Did it involve ONLY boarding/alighting a stationary vehicle, or ONLY loading/unloading cargo?",
    type: "boolean",
    required: true,
  },
  { id: "fatality", label: "Did anyone die?", type: "boolean", required: true },
  { id: "injuryTreatedAway", label: "Was anyone injured and taken for medical treatment away from the scene?", type: "boolean", required: true },
  {
    id: "towAway",
    label: "Was any vehicle towed or carried away because of disabling damage?",
    help: "Not counted: damage fixable on scene without special tools, flat tire only, lights, turn signals, horn or wipers.",
    type: "boolean",
    required: true,
  },
  {
    id: "driverCited",
    label: "Was our driver cited for a moving violation arising from the accident?",
    help: "Alcohol testing turns on a citation within 8 hours; drug testing within 32 hours. Choose 'Not yet known' and update when you hear.",
    type: "select",
    options: [
      { value: "YES", label: "Yes" },
      { value: "NO", label: "No" },
      { value: "PENDING", label: "Not yet known" },
    ],
    required: true,
  },
  { id: "hazmatInvolved", label: "Was the truck carrying hazardous materials?", type: "boolean", required: true },
  {
    id: "hazmatReleased",
    label: "Was any hazardous material released (not counting fuel from the truck's own tanks)?",
    type: "boolean",
    required: true,
    showIf: (a) => a.hazmatInvolved === true,
  },
  {
    id: "nrcTrigger",
    label: "Because of the hazmat: a death, hospital admission, evacuation ≥ 1 hour, or a major road/facility closed ≥ 1 hour?",
    type: "select",
    options: [
      { value: "YES", label: "Yes" },
      { value: "NO", label: "No" },
      { value: "UNSURE", label: "Not sure" },
    ],
    required: true,
    showIf: (a) => a.hazmatInvolved === true && a.hazmatReleased === true,
  },
];

export const dotAccidentResponse: WorkflowDefinition = {
  key: "DOT_ACCIDENT_RESPONSE",
  title: "Respond to an accident involving one of our drivers",
  description: "Post-accident testing windows, accident register, hazmat notices and records — with live deadlines from the time of the crash.",
  driver: "existing",
  questions: accidentQuestions,
  validate(a) {
    const errors = validateAnswers(accidentQuestions, a);
    if (!errors.accidentAt && a.accidentAt && new Date(String(a.accidentAt)).getTime() > Date.now() + 5 * 60_000)
      errors.accidentAt = "Accident time cannot be in the future";
    return errors;
  },
  derive(a) {
    const excluded = a.onlyBoardingOrCargo === true;
    const qualifyingNonFatal = a.injuryTreatedAway === true || a.towAway === true;
    return {
      ...a,
      qualifyingNonFatal,
      dotAccident: !excluded && (a.fatality === true || qualifyingNonFatal),
      driverCited: a.driverCited === "PENDING" ? "UNKNOWN" : a.driverCited,
      hazmatReleased: a.hazmatInvolved === true ? a.hazmatReleased : false,
      nrcTrigger: a.hazmatInvolved === true && a.hazmatReleased === true ? (a.nrcTrigger === "UNSURE" ? "UNKNOWN" : a.nrcTrigger) : "NO",
    };
  },
  warnings(a, facts) {
    const w: string[] = [];
    if (facts.dotAccident && a.fatality !== true && a.driverCited === "PENDING")
      w.push(
        "Citation status unknown: if the driver is cited within 8 hours, an alcohol test is required; within 32 hours, a drug test. Many carriers send the driver for testing now rather than miss the window — update the answer as soon as you know.",
      );
    if (a.fatality === true) w.push("Fatal accident: testing is required whether or not the driver is cited. Preserve all records immediately.");
    if (!facts.dotAccident) w.push("Based on your answers this does not meet the federal definition of an accident. Document the determination.");
    return w;
  },
};

// ─────────────────────────────── Drug & alcohol violation ───────────────────────────────

const violationQuestions: Question[] = [
  {
    id: "violationType",
    label: "What happened?",
    type: "select",
    options: [
      { value: "POSITIVE_DRUG", label: "MRO-verified positive drug test" },
      { value: "ADULTERATED_SUBSTITUTED", label: "MRO reported adulterated or substituted specimen" },
      { value: "ALCOHOL_04", label: "Alcohol confirmation test 0.04 or higher" },
      { value: "ALCOHOL_02_TO_04", label: "Alcohol confirmation test 0.02 – 0.039" },
      { value: "REFUSAL", label: "Possible refusal (no-show, left site, would not cooperate…)" },
      { value: "ACTUAL_KNOWLEDGE", label: "Supervisor observed / driver admitted on-duty use (actual knowledge)" },
    ],
    required: true,
  },
  { id: "determinationAt", label: "When did you receive the result or learn of the conduct?", type: "datetime", required: true },
  {
    id: "willReturnToDuty",
    label: "Do you intend to return the driver to safety-sensitive work?",
    type: "select",
    options: [
      { value: "YES", label: "Yes, after return-to-duty" },
      { value: "NO", label: "No" },
      { value: "UNDECIDED", label: "Undecided" },
    ],
    required: true,
    showIf: (a) => a.violationType !== "ALCOHOL_02_TO_04",
  },
];

export const drugAlcoholViolation: WorkflowDefinition = {
  key: "DRUG_ALCOHOL_VIOLATION",
  title: "Respond to a positive test, refusal or other drug/alcohol violation",
  description: "Immediate removal, Clearinghouse reporting deadlines, SAP referral and return-to-duty steps.",
  driver: "existing",
  questions: violationQuestions,
  validate(a) {
    return validateAnswers(violationQuestions, a);
  },
  derive(a) {
    const t = a.violationType;
    return {
      ...a,
      isViolation: t !== "ALCOHOL_02_TO_04",
      employerReports: t === "ALCOHOL_04" || t === "REFUSAL" || t === "ACTUAL_KNOWLEDGE",
      mroReports: t === "POSITIVE_DRUG" || t === "ADULTERATED_SUBSTITUTED",
      willReturnToDuty: t === "ALCOHOL_02_TO_04" ? "NO" : a.willReturnToDuty === "UNDECIDED" ? "UNKNOWN" : a.willReturnToDuty,
    };
  },
  warnings(a) {
    const w: string[] = [];
    if (a.violationType !== "ALCOHOL_02_TO_04")
      w.push("The driver must not perform any safety-sensitive function until the return-to-duty process is complete.");
    if (a.violationType === "ACTUAL_KNOWLEDGE")
      w.push("If the driver came forward under your voluntary self-identification program (382.121), different rules apply — check before reporting.");
    return w;
  },
};

// ─────────────────────────────── Shared: interstate / intrastate ───────────────────────────────

/**
 * Parts 390–399 bind interstate operations directly; an intrastate-only carrier is
 * governed by what its State adopted. The engine reads `operationType` and
 * `operatingState` to decide — these two questions feed it.
 */
const operationQuestions: Question[] = [
  {
    id: "operationType",
    label: "Does the company operate interstate, or only within one state?",
    help: "Interstate includes trips that cross state lines and in-state legs of a shipment that is moving interstate. Federal Parts 390–399 apply directly to interstate operations; intrastate-only operations follow the State’s adopted rules.",
    type: "select",
    options: [
      { value: "INTERSTATE", label: "Interstate (or both)" },
      { value: "INTRASTATE", label: "Intrastate only" },
      { value: "UNKNOWN", label: "Not sure" },
    ],
    required: true,
  },
  {
    id: "operatingState",
    label: "In which state does the company operate?",
    type: "state",
    options: STATE_OPTIONS,
    required: true,
    showIf: (a) => a.operationType === "INTRASTATE",
  },
];

function operationWarnings(a: Answers): string[] {
  if (a.operationType === "INTRASTATE")
    return [
      "Intrastate-only operation: federal Parts 390–399 do not apply automatically. Steps based on those parts are marked “Unable to determine” until your State’s adopted rules are confirmed — they are not cleared. Part 383 (CDL) and Part 382 (drug and alcohol testing) steps apply to intrastate CDL drivers as shown.",
    ];
  if (a.operationType === "UNKNOWN") return ["Interstate vs. intrastate is not settled, so steps that depend on it are marked “Unable to determine”. Update the answer when you know."];
  return [];
}

// ─────────────────────────────── Roadside inspection / out-of-service ───────────────────────────────

const roadsideQuestions: Question[] = [
  { id: "inspectionAt", label: "When was the inspection? (date and time)", help: "The 24-hour and 15-day deadlines are counted from this.", type: "datetime", required: true },
  { id: "inspectionState", label: "In which state did the inspection take place?", type: "state", options: STATE_OPTIONS, required: true },
  ...operationQuestions,
  {
    id: "vehicleOos",
    label: "Was the truck, trailer or other equipment placed out of service?",
    help: "Look for an “Out-of-Service Vehicle” sticker or an OOS mark next to a vehicle violation on the report.",
    type: "boolean",
    required: true,
  },
  { id: "driverOos", label: "Was the driver placed out of service?", type: "boolean", required: true },
  {
    id: "driverOosReason",
    label: "Why was the driver placed out of service?",
    type: "select",
    options: [
      { value: "HOS", label: "Hours of service — over hours, or no / incomplete log" },
      { value: "ALCOHOL", label: "Alcohol" },
      { value: "LICENSE_MEDICAL", label: "Licence, endorsement or medical certification" },
      { value: "OTHER", label: "Something else" },
      { value: "UNKNOWN", label: "Not sure yet — haven’t seen the report" },
    ],
    required: true,
    showIf: (a) => a.driverOos === true,
  },
  {
    id: "violationsFound",
    label: "Were any violations or defects written on the inspection report?",
    help: "A clean inspection (no violations) still creates a report to deliver and keep.",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.vehicleOos === false && a.driverOos === false,
  },
  {
    id: "stateRequestedReturn",
    label: "Has the issuing State agency asked for the signed report to be returned?",
    help: "Under the current rule the completed form is returned only if the issuing State agency requests it. Check the instructions printed on the report.",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.vehicleOos === true || a.driverOos === true || a.violationsFound !== "NO",
  },
  {
    id: "missingDocs",
    label: "Was the driver unable to produce a required document?",
    help: "For example a licence, medical card, logs, ELD instructions or proof of the vehicle’s annual inspection. Optional — answer Yes to add a step listing what must be carried.",
    type: "boolean",
    required: false,
    showIf: (a) => a.vehicleOos === true || a.driverOos === true || a.violationsFound !== "NO",
  },
];

export const roadsideInspection: WorkflowDefinition = {
  key: "ROADSIDE_INSPECTION",
  title: "Respond to a roadside inspection or out-of-service order",
  description: "What must stop, what to repair, the 24-hour and 15-day deadlines, and the record to keep — for Level I, II or III inspections, with or without an out-of-service order.",
  driver: "existing",
  questions: roadsideQuestions,
  validate(a) {
    const errors = validateAnswers(roadsideQuestions, a);
    if (!errors.inspectionAt && a.inspectionAt && new Date(String(a.inspectionAt)).getTime() > Date.now() + 5 * 60_000)
      errors.inspectionAt = "Inspection time cannot be in the future";
    return errors;
  },
  derive(a) {
    const anyOos = a.vehicleOos === true || a.driverOos === true;
    // An out-of-service declaration is itself a recorded violation; otherwise use the answer (unknown stays unknown).
    const reportHasViolations = anyOos ? true : a.violationsFound === "YES" ? true : a.violationsFound === "NO" ? false : undefined;
    return {
      ...a,
      reportHasViolations,
      stateRequestedReturn: reportHasViolations === false ? "NO" : a.stateRequestedReturn,
      // Optional question: unanswered means "no".
      missingDocs: reportHasViolations !== false && a.missingDocs === true,
      // For intrastate operations the engine looks up the operating state's adoption; fall back to where the inspection happened.
      operatingState: a.operatingState ?? a.inspectionState,
    };
  },
  warnings(a) {
    const w = operationWarnings(a);
    if (a.vehicleOos === true) w.push("The vehicle must not be operated — or towed, except by crane or hoist — until every repair on the out-of-service notice is complete. Do not remove the sticker early.");
    if (a.driverOos === true) w.push("The driver must not operate any commercial motor vehicle until the out-of-service order’s terms are met. Send a relief driver if the load must move.");
    if (a.driverOos === true && a.driverOosReason === "UNKNOWN") w.push("Get a copy of the report now: what ends the driver’s out-of-service order depends on the reason it was issued. Reason-specific steps are marked “Unable to determine” until you update the answer.");
    return w;
  },
};

// ─────────────────────────────── Hours of service ───────────────────────────────

const hosQuestions: Question[] = [
  {
    id: "situation",
    label: "What is the situation?",
    type: "select",
    options: [
      { value: "EXCEEDED", label: "The driver has already driven past a limit" },
      { value: "ABOUT_TO", label: "The driver is out of hours, or about to be, and has not gone over" },
    ],
    required: true,
  },
  {
    id: "vehicleType",
    label: "What kind of vehicle does the driver operate?",
    help: "Property-carrying and passenger-carrying drivers have different limits.",
    type: "select",
    options: [
      { value: "PROPERTY", label: "Property-carrying (truck)" },
      { value: "PASSENGER", label: "Passenger-carrying (bus, motorcoach)" },
    ],
    required: true,
  },
  ...operationQuestions,
  {
    id: "cause",
    label: "What caused the driver to run out of time?",
    type: "select",
    options: [
      { value: "ADVERSE", label: "Unexpected weather, road or traffic conditions" },
      { value: "EMERGENCY", label: "An emergency" },
      { value: "DISPATCH", label: "The schedule or dispatch — the trip didn’t fit in the hours" },
      { value: "DRIVER", label: "The driver’s own choice or mistake" },
      { value: "OTHER", label: "Something else / still finding out" },
    ],
    required: true,
  },
  {
    id: "knownBeforehand",
    label: "Were those conditions known — or could they reasonably have been known — before the driver started the day or was dispatched?",
    help: "For example a forecast storm, a posted closure, or ordinary rush-hour congestion. The exception only covers conditions that could not have been anticipated.",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.cause === "ADVERSE",
  },
  {
    id: "foundBy",
    label: "How did this come to light?",
    type: "select",
    options: [
      { value: "ROADSIDE", label: "A roadside inspection (citation or out-of-service order)" },
      { value: "INTERNAL", label: "Internally — the driver, dispatch or a log review" },
    ],
    required: true,
  },
];

export const hosViolation: WorkflowDefinition = {
  key: "HOS_VIOLATION",
  title: "Driver is out of hours or exceeded hours-of-service limits",
  description: "What the driver and dispatcher must do, whether an exception applies, and how to keep the record accurate — for the 11-hour, 14-hour, 30-minute and 60/70-hour limits.",
  driver: "existing",
  questions: hosQuestions,
  validate(a) {
    return validateAnswers(hosQuestions, a);
  },
  derive(a) {
    return { ...a, knownBeforehand: a.cause === "ADVERSE" ? a.knownBeforehand : "NO" };
  },
  warnings(a) {
    const w = operationWarnings(a);
    if (a.vehicleType === "PASSENGER") w.push("Passenger-carrying limits (49 CFR 395.5) are not loaded. The property-carrying steps do not apply to this driver — see the review item.");
    if (a.situation === "ABOUT_TO") w.push("The driver has not gone over: the priority is to stop before the limit, not to finish the run. Arrange relief or a layover.");
    if (a.cause === "DISPATCH") w.push("A schedule that cannot be run legally is the carrier’s violation as well as the driver’s: no motor carrier may permit or require driving beyond the limits.");
    return w;
  },
};

// ─────────────────────────────── Medical certificate ───────────────────────────────

const medicalQuestions: Question[] = [
  {
    id: "licenseType",
    label: "Does the driver hold a CDL or CLP?",
    help: "For CDL/CLP holders the State driving record is the proof of medical certification; for other CMV drivers it is the certificate itself.",
    type: "select",
    options: [
      { value: "CDL", label: "Yes — CDL or CLP" },
      { value: "NON_CDL", label: "No — drives CMVs that don’t require a CDL" },
    ],
    required: true,
  },
  {
    id: "certStatus",
    label: "Has the medical certification already expired?",
    type: "select",
    options: [
      { value: "EXPIRED", label: "Yes — it has expired" },
      { value: "EXPIRING", label: "No — it expires soon" },
    ],
    required: true,
  },
  ...operationQuestions,
  {
    id: "hasVariance",
    label: "Does the driver’s medical qualification rely on a medical variance?",
    help: "An FMCSA medical exemption letter or a Skill Performance Evaluation (SPE) certificate.",
    type: "boolean",
    required: true,
  },
];

export const medicalCertExpired: WorkflowDefinition = {
  key: "MEDICAL_CERT_EXPIRED",
  title: "Driver’s medical certificate expires or has expired",
  description: "Whether the driver can drive, how to get recertified, and how to verify and file the new certification — including the electronic process for CDL holders since June 23, 2025.",
  driver: "existing",
  questions: medicalQuestions,
  validate(a) {
    return validateAnswers(medicalQuestions, a);
  },
  derive(a) {
    return { ...a };
  },
  warnings(a) {
    const w = operationWarnings(a);
    if (a.certStatus === "EXPIRED") w.push("The driver must not operate a commercial motor vehicle until a new medical certification has been issued and you have verified it. There is no grace period.");
    if (a.licenseType === "CDL") w.push("CDL/CLP holders: since June 23, 2025 the exam result is sent electronically to the State, and a paper certificate is no longer accepted as proof. Allow time for the State record to update.");
    return w;
  },
};

// ─────────────────────────────── CDL suspended / disqualified ───────────────────────────────

const cdlQuestions: Question[] = [
  {
    id: "licenseEvent",
    label: "What happened to the driver’s licence?",
    type: "select",
    options: [
      { value: "SUSPENDED_REVOKED", label: "Suspended, revoked, cancelled or withdrawn" },
      { value: "DISQUALIFIED", label: "Disqualified from operating a CMV" },
      { value: "DOWNGRADED", label: "CDL downgraded (medical or Clearinghouse)" },
      { value: "EXPIRED", label: "Expired — not renewed in time" },
      { value: "UNKNOWN_EVENT", label: "Not sure — something is wrong with the licence" },
    ],
    required: true,
  },
  { id: "licenseState", label: "Which state issued the licence?", type: "state", options: STATE_OPTIONS, required: true },
  ...operationQuestions,
  {
    id: "noticeReceivedAt",
    label: "When did the driver receive notice of the action?",
    help: "The driver’s deadline to tell the company is the end of the next business day after this date. Leave blank if not known.",
    type: "date",
    required: false,
    showIf: (a) => a.licenseEvent === "SUSPENDED_REVOKED" || a.licenseEvent === "DISQUALIFIED" || a.licenseEvent === "UNKNOWN_EVENT",
  },
  {
    id: "convictionInvolved",
    label: "Does the action follow a traffic conviction?",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.licenseEvent !== "EXPIRED" && a.licenseEvent !== "DOWNGRADED",
  },
  {
    id: "alcoholDrugRelated",
    label: "Is it related to alcohol or drugs (for example a DUI)?",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.licenseEvent !== "EXPIRED" && a.licenseEvent !== "DOWNGRADED",
  },
];

export const cdlDisqualified: WorkflowDefinition = {
  key: "CDL_DISQUALIFIED",
  title: "Driver’s CDL is suspended, revoked, disqualified or expired",
  description: "Taking the driver off the road, the notifications the driver owes the company, and what to verify before the driver returns.",
  driver: "existing",
  questions: cdlQuestions,
  validate(a) {
    return validateAnswers(cdlQuestions, a);
  },
  derive(a) {
    const noConviction = a.licenseEvent === "EXPIRED" || a.licenseEvent === "DOWNGRADED";
    return {
      ...a,
      convictionInvolved: noConviction ? "NO" : a.convictionInvolved,
      alcoholDrugRelated: noConviction ? "NO" : a.alcoholDrugRelated,
    };
  },
  warnings(a) {
    const w = operationWarnings(a);
    w.push("The driver must not operate a commercial motor vehicle until the licence is valid again. Once the company knows — or should reasonably know — it may not allow the driver to drive.");
    if (a.alcoholDrugRelated === "YES") w.push("Alcohol- or drug-related: the licence action is separate from any Part 382 drug-and-alcohol duties. See the review item.");
    return w;
  },
};

// ─────────────────────────────── Driver leaves the company ───────────────────────────────

const separationQuestions: Question[] = [
  { id: "companyState", label: "In which state was the driver employed?", help: "Used only for State employment-law items such as final pay.", type: "state", options: STATE_OPTIONS, required: true },
  ...operationQuestions,
  {
    id: "cdlDriver",
    label: "Was the driver subject to DOT drug and alcohol testing?",
    help: "Every driver of a CDL-required vehicle is covered by 49 CFR Part 382.",
    type: "boolean",
    required: true,
  },
  {
    id: "openViolation",
    label: "Is there an unresolved drug or alcohol matter?",
    help: "For example: a violation not yet reported to the Clearinghouse, a driver who left instead of taking a test, or a return-to-duty or follow-up testing plan that isn’t finished.",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.cdlDriver === true,
  },
];

export const driverSeparation: WorkflowDefinition = {
  key: "DRIVER_SEPARATION",
  title: "A driver leaves the company",
  description: "Which records to keep and for how long, what must still be reported, and how to answer the next employer — whether the driver quit, was terminated or was laid off.",
  driver: "existing",
  questions: separationQuestions,
  validate(a) {
    return validateAnswers(separationQuestions, a);
  },
  derive(a) {
    return { ...a, openViolation: a.cdlDriver === true ? a.openViolation : "NO" };
  },
  warnings(a) {
    const w = operationWarnings(a);
    w.push("Do not purge the driver’s files at separation — most records must be kept for years after the driver leaves.");
    if (a.cdlDriver === true && a.openViolation === "UNKNOWN") w.push("Check the driver’s drug and alcohol file and Clearinghouse record before closing out: reporting duties do not end when the driver leaves.");
    return w;
  },
};

// ═══════════════════════════════ Catalog 2026.10.2 ═══════════════════════════════

// ─────────────────────────────── Short-haul status ───────────────────────────────

const shortHaulQuestions: Question[] = [
  {
    id: "pattern",
    label: "What is changing for this driver?",
    type: "select",
    options: [
      { value: "ONE_DAY", label: "A short-haul driver went (or will go) outside the limits on a particular day" },
      { value: "MIXED", label: "The driver regularly does both local and longer runs" },
      { value: "PERMANENT", label: "The driver is moving from local to long-haul / over-the-road work" },
    ],
    required: true,
  },
  {
    id: "cdlRequired",
    label: "Does the vehicle the driver operates require a CDL?",
    help: "The short-haul provisions are different for CDL-required vehicles and for lighter commercial vehicles.",
    type: "boolean",
    required: true,
  },
  ...operationQuestions,
  {
    id: "logDays",
    label: "On how many days in any 30-day period will the driver need a full log?",
    help: "Count the days the driver does not meet every short-haul condition. This decides whether a paper log is enough or an ELD is required.",
    type: "select",
    options: [
      { value: "EIGHT_OR_FEWER", label: "8 days or fewer" },
      { value: "MORE_THAN_EIGHT", label: "More than 8 days" },
      { value: "UNKNOWN", label: "Not sure yet" },
    ],
    required: true,
    showIf: (a) => a.pattern !== "PERMANENT",
  },
];

export const shortHaulStatus: WorkflowDefinition = {
  key: "SHORT_HAUL_STATUS",
  title: "Short-haul driver goes outside the limits, or moves to long-haul work",
  description: "Whether the short-haul exception still applies, when a full log is needed, and when the driver needs an ELD.",
  driver: "existing",
  questions: shortHaulQuestions,
  validate(a) {
    return validateAnswers(shortHaulQuestions, a);
  },
  derive(a) {
    return { ...a, logDays: a.pattern === "PERMANENT" ? "MORE_THAN_EIGHT" : a.logDays };
  },
  warnings(a) {
    const w = operationWarnings(a);
    if (a.pattern === "ONE_DAY") w.push("The short-haul exception is all-or-nothing for each day. On a day when any condition is missed, the driver needs a full record of duty status for that day and the 30-minute interruption rule applies.");
    if (a.pattern === "PERMANENT") w.push("Once the driver stops returning to the reporting location within the short-haul conditions, every standard hours-of-service rule applies from the first trip — including daily logs and, in most cases, an ELD.");
    return w;
  },
};

// ─────────────────────────────── ELD malfunction ───────────────────────────────

const eldQuestions: Question[] = [
  {
    id: "issueType",
    label: "What is the ELD showing?",
    help: "The device’s instruction sheet in the cab explains its indicators. A malfunction means the ELD is not recording properly; a data diagnostic event is a data inconsistency the driver can usually clear.",
    type: "select",
    options: [
      { value: "MALFUNCTION", label: "A malfunction — it has stopped working or recording properly" },
      { value: "DATA_DIAGNOSTIC", label: "A data diagnostic event" },
      { value: "UNKNOWN", label: "Not sure which" },
    ],
    required: true,
  },
  { id: "malfunctionAt", label: "When was the problem discovered or reported? (date and time)", help: "The 24-hour, 5-day and 8-day deadlines are counted from this.", type: "datetime", required: true },
  ...operationQuestions,
  {
    id: "recordsAvailable",
    label: "Does the driver already have the logs for today and the previous 7 days, or can they be retrieved from the ELD?",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.issueType !== "DATA_DIAGNOSTIC",
  },
  {
    id: "fixWithin8Days",
    label: "Can the ELD be repaired or replaced within 8 days?",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.issueType !== "DATA_DIAGNOSTIC",
  },
];

export const eldMalfunction: WorkflowDefinition = {
  key: "ELD_MALFUNCTION",
  title: "Driver’s ELD stops working",
  description: "What the driver must do straight away, the carrier’s 8-day repair deadline, and how to ask FMCSA for more time.",
  driver: "existing",
  questions: eldQuestions,
  validate(a) {
    const errors = validateAnswers(eldQuestions, a);
    if (!errors.malfunctionAt && a.malfunctionAt && new Date(String(a.malfunctionAt)).getTime() > Date.now() + 5 * 60_000) errors.malfunctionAt = "This time cannot be in the future";
    return errors;
  },
  derive(a) {
    const diag = a.issueType === "DATA_DIAGNOSTIC";
    return { ...a, recordsAvailable: diag ? "YES" : a.recordsAvailable, fixWithin8Days: diag ? "YES" : a.fixWithin8Days };
  },
  warnings(a) {
    const w = operationWarnings(a);
    if (a.issueType !== "DATA_DIAGNOSTIC") w.push("The driver may keep driving on paper logs while the ELD is being fixed — but only if the logs are kept every day and the carrier meets the 8-day repair deadline or files a timely extension request.");
    if (a.issueType === "UNKNOWN") w.push("Check the ELD’s instruction sheet to confirm whether this is a malfunction or a data diagnostic event; the malfunction steps are marked “Unable to determine” until you update the answer.");
    return w;
  },
};

// ─────────────────────────────── Ticket, arrest or conviction ───────────────────────────────

const citationQuestions: Question[] = [
  {
    id: "offense",
    label: "What is the offence?",
    type: "select",
    options: [
      { value: "SPEEDING_15", label: "Speeding 15 mph or more over the limit" },
      { value: "OTHER_SERIOUS", label: "Reckless driving, improper lane change, following too closely, or texting / hand-held phone in a CMV" },
      { value: "DUI", label: "Driving under the influence (alcohol or drugs), or refusing a test" },
      { value: "MINOR", label: "Another moving violation (for example speeding less than 15 mph over)" },
      { value: "OTHER", label: "Something else / not sure" },
    ],
    required: true,
  },
  {
    id: "vehicle",
    label: "What was the driver operating?",
    type: "select",
    options: [
      { value: "CMV", label: "A commercial motor vehicle" },
      { value: "PERSONAL", label: "A personal vehicle" },
    ],
    required: true,
  },
  {
    id: "stage",
    label: "Where does the case stand?",
    type: "select",
    options: [
      { value: "CITED", label: "Cited or arrested — not decided yet" },
      { value: "CONVICTED", label: "Convicted (including paying the ticket or forfeiting bond)" },
    ],
    required: true,
  },
  { id: "cdlHolder", label: "Does the driver hold a CDL or CLP?", type: "boolean", required: true },
  { id: "licenseState", label: "Which state issued the driver’s licence?", type: "state", options: STATE_OPTIONS, required: true },
  ...operationQuestions,
  {
    id: "priorSerious",
    label: "Does the driver have another serious traffic violation conviction in the past 3 years?",
    help: "Serious violations include speeding 15 mph or more over, reckless driving, improper lane changes, following too closely, and texting or hand-held phone use in a CMV.",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => (a.offense === "SPEEDING_15" || a.offense === "OTHER_SERIOUS") && a.stage === "CONVICTED",
  },
  {
    id: "licenseAction",
    label: "Has the driver’s licence been suspended, revoked or cancelled as a result?",
    help: "A State can suspend a licence administratively before any conviction.",
    type: "select",
    options: YNU,
    required: true,
  },
];

export const driverCitation: WorkflowDefinition = {
  key: "DRIVER_CITATION",
  title: "Driver receives a ticket, is arrested, or is convicted",
  description: "What the driver must report, whether the driver will be disqualified, and when a citation triggers drug-and-alcohol duties.",
  driver: "existing",
  questions: citationQuestions,
  validate(a) {
    return validateAnswers(citationQuestions, a);
  },
  derive(a) {
    const serious = a.offense === "SPEEDING_15" || a.offense === "OTHER_SERIOUS";
    return {
      ...a,
      seriousOffense: serious,
      priorSerious: serious && a.stage === "CONVICTED" ? a.priorSerious : "NO",
    };
  },
  warnings(a) {
    const w = operationWarnings(a);
    if (a.offense === "DUI" && a.vehicle === "CMV") w.push("A citation for driving a CMV under the influence is “actual knowledge” of a drug-and-alcohol violation. The driver must be removed from safety-sensitive functions now — do not wait for the court.");
    if (a.offense === "DUI" && a.vehicle === "PERSONAL") w.push("An off-duty DUI in a personal vehicle is handled through the licence, not the Clearinghouse — but a conviction still costs a CDL holder at least a year.");
    if (a.licenseAction === "YES") w.push("The driver must not operate a commercial motor vehicle while the licence is suspended, revoked or cancelled.");
    if (a.cdlHolder === false) w.push("The disqualification tables in Part 383 apply to CLP/CDL holders. For a driver without a CDL, see the annual-review and State steps; the disqualification rules in § 391.15 may still apply.");
    return w;
  },
};

// ─────────────────────────────── Vehicle inspection & maintenance ───────────────────────────────

const vehicleQuestions: Question[] = [
  {
    id: "situation",
    label: "What is the situation?",
    type: "select",
    options: [
      { value: "ANNUAL_EXPIRED", label: "The annual (periodic) inspection has expired or is about to" },
      { value: "DEFECT_REPORTED", label: "A driver has reported a defect (for example brakes)" },
      { value: "BREAKDOWN", label: "A vehicle has broken down on a trip" },
      { value: "RECORDS_MISSING", label: "Maintenance records are missing or incomplete" },
      { value: "NEW_UNIT", label: "A truck or trailer is being added to the fleet" },
    ],
    required: true,
  },
  {
    id: "unitType",
    label: "What kind of unit is it?",
    type: "select",
    options: [
      { value: "POWER", label: "Truck or tractor" },
      { value: "TRAILER", label: "Trailer or converter dolly" },
    ],
    required: true,
  },
  ...operationQuestions,
  {
    id: "defectAffectsSafety",
    label: "Is the defect likely to affect the safe operation of the vehicle?",
    help: "Brakes, steering, tires, wheels, lights and coupling devices nearly always are. If unsure, have a qualified mechanic decide before the vehicle moves.",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.situation === "DEFECT_REPORTED",
  },
  {
    id: "oneVehicleCarrier",
    label: "Does the company operate only one commercial motor vehicle?",
    help: "The written driver vehicle inspection report rule does not apply to a carrier with a single CMV.",
    type: "boolean",
    required: true,
    showIf: (a) => a.situation === "DEFECT_REPORTED",
  },
  {
    id: "stoppedOnHighway",
    label: "Is the vehicle stopped on the road or the shoulder of a highway?",
    type: "boolean",
    required: true,
    showIf: (a) => a.situation === "BREAKDOWN",
  },
  {
    id: "control30Days",
    label: "Does (or will) the company control this vehicle for 30 consecutive days or more?",
    help: "The maintenance-records requirement applies to vehicles the carrier controls for 30 consecutive days — owned, or leased for that long.",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.situation === "RECORDS_MISSING" || a.situation === "NEW_UNIT",
  },
];

export const vehicleMaintenance: WorkflowDefinition = {
  key: "VEHICLE_MAINTENANCE",
  title: "Vehicle inspection, defect, breakdown or maintenance records",
  description: "Whether the vehicle can be used, what must be inspected or repaired, and the records to keep — for trucks, tractors and trailers.",
  driver: "optional",
  questions: vehicleQuestions,
  validate(a) {
    return validateAnswers(vehicleQuestions, a);
  },
  derive(a) {
    return { ...a };
  },
  warnings(a) {
    const w = operationWarnings(a);
    if (a.situation === "ANNUAL_EXPIRED") w.push("A vehicle without a periodic inspection in the preceding 12 months may not be used. Each trailer and converter dolly needs its own inspection.");
    if (a.situation === "DEFECT_REPORTED" && a.defectAffectsSafety !== "NO") w.push("Do not dispatch the vehicle until a qualified person has either repaired the defect or certified that repair is unnecessary.");
    if (a.situation === "BREAKDOWN") w.push("An unsafe vehicle may be driven only to the nearest place where it can safely be repaired — not to finish the delivery.");
    if (a.situation === "NEW_UNIT") w.push("Registration, IRP, IFTA, insurance and vehicle-marking items are listed for planning but have not been verified — confirm each with the issuing agency.");
    return w;
  },
};

// ─────────────────────────────── Random test selection ───────────────────────────────

const randomQuestions: Question[] = [
  {
    id: "reason",
    label: "Why can’t the selected driver be tested right now?",
    type: "select",
    options: [
      { value: "ON_THE_ROAD", label: "Working, but away from the terminal or on the road" },
      { value: "SHORT_ABSENCE", label: "Off, sick or on vacation — back before the selection period ends" },
      { value: "LONG_ABSENCE", label: "Away for the rest of the selection period (leave, layoff, long vacation)" },
      { value: "NO_SHOW", label: "Was told to report for the test and did not go" },
      { value: "LEFT_COMPANY", label: "No longer works for the company" },
    ],
    required: true,
  },
  {
    id: "testType",
    label: "Which test was the driver selected for?",
    type: "select",
    options: [
      { value: "DRUG", label: "Drug (controlled substances)" },
      { value: "ALCOHOL", label: "Alcohol" },
      { value: "BOTH", label: "Both" },
    ],
    required: true,
  },
];

export const randomTestSelection: WorkflowDefinition = {
  key: "RANDOM_TEST_SELECTION",
  title: "Driver selected for random testing is unavailable",
  description: "How to complete the selection properly, when a missed test is a refusal, and how to keep the annual testing rate on track.",
  driver: "existing",
  questions: randomQuestions,
  validate(a) {
    return validateAnswers(randomQuestions, a);
  },
  derive(a) {
    return { ...a };
  },
  warnings(a) {
    const w: string[] = [];
    if (a.reason === "NO_SHOW") w.push("A driver who was notified and did not report may have refused the test. Do not let the driver perform safety-sensitive functions until the designated employer representative has made and recorded a decision.");
    if (a.reason === "LONG_ABSENCE") w.push("The regulation has no exception for an absent driver. FleetComply flags this step for review rather than telling you the selection can be skipped.");
    if (a.reason !== "NO_SHOW" && a.reason !== "LEFT_COMPANY") w.push("Do not tell the driver about the selection until they can go straight to the collection site.");
    return w;
  },
};

// ═══════════════════════════════ Catalog 2026.10.3 ═══════════════════════════════

// ─────────────────────────────── Lease a truck temporarily ───────────────────────────────

const leaseQuestions: Question[] = [
  {
    id: "carrierType",
    label: "How does your company operate?",
    help: "The federal leasing rules (49 CFR Part 376) apply to for-hire carriers registered with FMCSA — not to a company that only hauls its own goods.",
    type: "select",
    options: [
      { value: "FOR_HIRE", label: "For-hire carrier — we haul other people’s freight under our FMCSA operating authority" },
      { value: "PRIVATE", label: "Private carrier — we only haul our own goods" },
      { value: "UNKNOWN", label: "Not sure" },
    ],
    required: true,
  },
  {
    id: "lessorType",
    label: "Who are you getting the vehicle from?",
    type: "select",
    options: [
      { value: "RENTAL_COMPANY", label: "A truck rental or leasing company" },
      { value: "OWNER", label: "An individual or business that owns the truck (for example an owner-operator)" },
      { value: "AUTHORIZED_CARRIER", label: "Another for-hire motor carrier with FMCSA authority" },
      { value: "PRIVATE_CARRIER", label: "A private carrier (a company that hauls its own goods)" },
    ],
    required: true,
  },
  { id: "withDriver", label: "Does the vehicle come with a driver supplied by the lessor?", type: "boolean", required: true },
  {
    id: "unitType",
    label: "What are you leasing?",
    type: "select",
    options: [
      { value: "POWER", label: "A truck or tractor (with or without a trailer)" },
      { value: "TRAILER", label: "A trailer only — pulled by our own tractor" },
    ],
    required: true,
  },
  {
    id: "term",
    label: "How long will you have it?",
    help: "30 days is the line for two rules: using the rental company’s markings, and keeping a maintenance file for the unit.",
    type: "select",
    options: [
      { value: "UP_TO_30", label: "30 days or less" },
      { value: "OVER_30", label: "More than 30 days" },
    ],
    required: true,
  },
  { id: "hazmat", label: "Will the vehicle carry hazardous materials?", help: "This affects the federal minimum insurance that applies.", type: "boolean", required: true },
  ...operationQuestions,
  { id: "registrationState", label: "In which state is the vehicle registered?", type: "state", options: STATE_OPTIONS, required: true },
];

export const leasedEquipment: WorkflowDefinition = {
  key: "LEASED_EQUIPMENT",
  title: "Lease or rent a truck temporarily",
  description: "Which leasing rules apply to your arrangement, what paperwork must be in the cab, and who is responsible for insurance, inspection, the driver and the records — from pick-up to return.",
  driver: "optional",
  questions: leaseQuestions,
  validate(a) {
    return validateAnswers(leaseQuestions, a);
  },
  derive(a) {
    let leaseRegime: string;
    if (a.carrierType === "UNKNOWN") leaseRegime = "UNKNOWN";
    else if (a.carrierType === "PRIVATE") leaseRegime = "NOT_SUBJECT";
    // § 376.21(d): a trailer not drawn by a power unit leased from the same lessor. § 376.21(c): no driver, from a leasing business.
    else if (a.unitType === "TRAILER" || (a.lessorType === "RENTAL_COMPANY" && a.withDriver === false)) leaseRegime = "EXEMPT";
    else if (a.lessorType === "AUTHORIZED_CARRIER" || a.lessorType === "PRIVATE_CARRIER") leaseRegime = "CARRIER_TO_CARRIER";
    else leaseRegime = "FULL";
    return { ...a, leaseRegime };
  },
  warnings(a) {
    const w = operationWarnings(a);
    w.push("Whoever owns the truck, your company is the motor carrier while it runs under your control: its inspection, maintenance, driver and hours of service are your responsibility.");
    if (a.carrierType === "UNKNOWN") w.push("Whether the Part 376 leasing rules apply depends on whether you are a for-hire carrier. Those steps are marked “Unable to determine” until you update the answer.");
    if (a.withDriver === true) w.push("A driver supplied with the truck must be fully qualified as your driver before the first trip.");
    if (a.carrierType === "FOR_HIRE" && a.lessorType === "RENTAL_COMPANY" && a.withDriver === true)
      w.push("A rental with a driver does not fit the “leased without drivers” exemption, so the full lease requirements are shown.");
    return w;
  },
};

// ─────────────────────────────── Open a new trucking company ───────────────────────────────

const VEHICLE_WEIGHT_OPTIONS = [
  { value: "UNDER_10001", label: "All under 10,001 lbs (gross vehicle or combination weight)" },
  { value: "FROM_10001", label: "10,001 – 26,000 lbs" },
  { value: "OVER_26000", label: "26,001 lbs or more" },
  { value: "UNKNOWN", label: "Not sure yet" },
];

const startupQuestions: Question[] = [
  { id: "baseState", label: "In which state will the company be based?", type: "state", options: STATE_OPTIONS, required: true },
  operationQuestions[0],
  {
    id: "cargo",
    label: "What will you transport?",
    type: "select",
    options: [
      { value: "PROPERTY", label: "Property (freight)" },
      { value: "PASSENGERS", label: "Passengers" },
    ],
    required: true,
  },
  {
    id: "forHire",
    label: "Will you be paid to haul other people’s freight or passengers?",
    help: "For-hire carriers haul for compensation. A business that only moves its own goods is a private carrier.",
    type: "select",
    options: [
      { value: "YES", label: "Yes — for-hire" },
      { value: "NO", label: "No — only our own goods (private carrier)" },
      { value: "UNKNOWN", label: "Not sure yet" },
    ],
    required: true,
  },
  {
    id: "vehicleWeight",
    label: "How heavy will your largest vehicle or combination be?",
    help: "Use the higher of the actual weight and the manufacturer’s rating. 10,001 lbs is the line for most federal safety rules; 26,001 lbs is the line for a CDL.",
    type: "select",
    options: VEHICLE_WEIGHT_OPTIONS,
    required: true,
  },
  { id: "hazmat", label: "Will you transport hazardous materials in quantities that require placards?", type: "boolean", required: true },
  {
    id: "cdlDrivers",
    label: "Will any driver operate a vehicle that requires a CDL?",
    help: "A CDL is required for vehicles of 26,001 lbs or more, vehicles designed for 16 or more passengers, and any vehicle carrying placarded hazardous materials.",
    type: "boolean",
    required: true,
  },
  { id: "ownerDrives", label: "Will the owner also drive?", type: "boolean", required: true },
  { id: "multiState", label: "Will your vehicles travel in more than one state?", type: "boolean", required: true },
];

export const newCarrierStartup: WorkflowDefinition = {
  key: "NEW_CARRIER_STARTUP",
  title: "Open a new trucking company",
  description: "Registration, authority, insurance, drivers, vehicles and the first 18 months — tailored to whether you are interstate or intrastate, for-hire or private, and what you haul.",
  driver: "optional",
  questions: startupQuestions,
  validate(a) {
    const errors = validateAnswers(startupQuestions, a);
    if (a.hazmat === true && a.cdlDrivers === false) errors.cdlDrivers = "Placarded hazardous materials require a CDL — answer Yes, or change the hazardous-materials answer.";
    if (a.vehicleWeight === "OVER_26000" && a.cdlDrivers === false) errors.cdlDrivers = "Vehicles of 26,001 lbs or more require a CDL — answer Yes, or change the weight.";
    return errors;
  },
  derive(a) {
    // § 390.5T commercial motor vehicle: 10,001 lbs or more, placarded hazmat, or passenger counts (not asked → unknown).
    let cmv: boolean | "UNKNOWN";
    if (a.hazmat === true || a.vehicleWeight === "FROM_10001" || a.vehicleWeight === "OVER_26000") cmv = true;
    else if (a.vehicleWeight === "UNKNOWN" || a.cargo === "PASSENGERS") cmv = "UNKNOWN";
    else cmv = false;
    const needsAuthority = a.forHire === "YES" ? true : a.forHire === "NO" ? false : "UNKNOWN";
    return { ...a, cmv, needsAuthority, operatingState: a.baseState };
  },
  warnings(a) {
    const w: string[] = [];
    if (a.operationType === "INTRASTATE")
      w.push("Intrastate-only: your State, not FMCSA, decides most of what you need. Federal steps are marked “Unable to determine” until the State’s rules are confirmed. Federal CDL and drug-and-alcohol testing rules still apply to CDL drivers.");
    if (a.operationType === "UNKNOWN") w.push("Whether you are interstate or intrastate is the first thing to settle — most steps are marked “Unable to determine” until you update the answer.");
    if (a.vehicleWeight === "UNDER_10001" && a.hazmat !== true && a.cargo === "PROPERTY")
      w.push("With every vehicle under 10,001 lbs and no placarded hazardous materials, your vehicles are not “commercial motor vehicles” under the federal safety rules, so most of those steps do not apply. State rules and customer requirements may still.");
    if (a.cargo === "PASSENGERS") w.push("Passenger carriers have their own insurance minimums, hours-of-service limits and vehicle thresholds. This workflow was written mainly for property carriers — passenger-specific items are flagged for review.");
    w.push("No fees are quoted in this guide: confirm current amounts with FMCSA and your State when you apply.");
    return w;
  },
};

// ─────────────────────────────── DOT audit notice received ───────────────────────────────

const hasFixedPeriod = (a: Answers) => a.reviewType === "CORRECTIVE_NOTICE" || a.reviewType === "RATING_NOTICE";

const auditQuestions: Question[] = [
  {
    id: "reviewType",
    label: "What does the notice say this is?",
    help: "Look for these words on the notice. The process, the stakes and the deadlines are different for each.",
    type: "select",
    options: [
      { value: "NEW_ENTRANT_AUDIT", label: "A new-entrant safety audit (the company is in its first 18 months)" },
      { value: "COMPLIANCE_REVIEW", label: "A compliance review or investigation" },
      { value: "CORRECTIVE_NOTICE", label: "A notice that we failed a safety audit and must take corrective action" },
      { value: "RATING_NOTICE", label: "A notice of a proposed safety rating" },
      { value: "UNKNOWN", label: "Not sure — the notice doesn’t make it clear" },
    ],
    required: true,
  },
  {
    id: "issuer",
    label: "Who sent the notice?",
    type: "select",
    options: [
      { value: "FMCSA", label: "FMCSA (U.S. Department of Transportation)" },
      { value: "STATE", label: "A State agency (State police, DOT or public utilities commission)" },
      { value: "UNKNOWN", label: "Not sure" },
    ],
    required: true,
  },
  ...operationQuestions,
  {
    id: "reviewFormat",
    label: "How will the review be carried out?",
    type: "select",
    options: [
      { value: "REMOTE", label: "Remotely — we submit documents" },
      { value: "ONSITE", label: "On-site — the reviewer visits us" },
      { value: "NOT_SURE", label: "Not sure yet" },
    ],
    required: true,
    showIf: (a) => !hasFixedPeriod(a),
  },
  {
    id: "carrierClass",
    label: "Does the company transport passengers or placarded hazardous materials?",
    help: "Passenger and hazardous-materials carriers are given shorter periods to respond.",
    type: "select",
    options: [
      { value: "GENERAL", label: "No — general freight / property only" },
      { value: "PASSENGER_OR_HAZMAT", label: "Yes — passengers or placarded hazardous materials" },
    ],
    required: true,
  },
  { id: "cdlDrivers", label: "Does the company use drivers who need a CDL?", help: "This decides whether drug and alcohol testing records are part of the review.", type: "boolean", required: true },
  {
    id: "proposedRating",
    label: "Which rating is proposed?",
    type: "select",
    options: [
      { value: "CONDITIONAL", label: "Conditional" },
      { value: "UNSATISFACTORY", label: "Unsatisfactory" },
    ],
    required: true,
    showIf: (a) => a.reviewType === "RATING_NOTICE",
  },
  {
    id: "noticeReceivedAt",
    label: "What is the date on the notice?",
    help: "The regulatory periods run from the date of the notice, not the day you opened it. Leave blank if you don’t have it to hand.",
    type: "date",
    required: false,
    showIf: hasFixedPeriod,
  },
];

export const auditNotice: WorkflowDefinition = {
  key: "AUDIT_NOTICE",
  title: "DOT audit, investigation or safety-rating notice received",
  description: "What kind of review it is, what to preserve and prepare, the deadlines that really apply, and what to do with the result — for new-entrant safety audits, compliance reviews and rating notices.",
  driver: "optional",
  questions: auditQuestions,
  validate(a) {
    return validateAnswers(auditQuestions, a);
  },
  derive(a) {
    return {
      ...a,
      proposedRating: a.reviewType === "RATING_NOTICE" ? a.proposedRating : "NONE",
      reviewFormat: hasFixedPeriod(a) ? "NONE" : a.reviewFormat,
    };
  },
  warnings(a) {
    const w = operationWarnings(a);
    w.push("There is no single “DOT audit” and no universal response deadline. Use the dates in your notice; the fixed regulatory periods below apply only where shown.");
    if (a.reviewType === "RATING_NOTICE" && a.proposedRating === "UNSATISFACTORY")
      w.push("A proposed unsatisfactory rating will stop the company operating if it becomes final. Get a transportation attorney or qualified regulatory consultant involved now.");
    if (a.reviewType === "CORRECTIVE_NOTICE") w.push("A corrective action notice has a fixed deadline, after which registration is revoked and operations are placed out of service. Professional help is strongly advisable.");
    if (a.reviewType === "UNKNOWN") w.push("Ask the sender in writing what kind of review this is. Steps that depend on the answer are marked “Unable to determine”.");
    if (hasFixedPeriod(a) && !a.noticeReceivedAt) w.push("Enter the date on the notice to see the actual deadline dates.");
    return w;
  },
};

// ─────────────────────────────── Driver moves to another state ───────────────────────────────

const relocationQuestions: Question[] = [
  { id: "fromState", label: "Which state is the driver moving from?", type: "state", options: STATE_OPTIONS, required: true },
  { id: "toState", label: "Which state is the driver moving to?", type: "state", options: STATE_OPTIONS, required: true },
  {
    id: "domicileEstablished",
    label: "Has the driver made the new state their permanent home yet?",
    help: "Domicile is the driver’s true, fixed and permanent home — not a temporary address while working away. The licence-transfer period runs from the day it changes.",
    type: "select",
    options: [
      { value: "YES", label: "Yes — they live there permanently now" },
      { value: "NO", label: "Not yet — the move is planned or temporary" },
      { value: "UNKNOWN", label: "Not sure" },
    ],
    required: true,
  },
  {
    id: "domicileEstablishedOn",
    label: "On what date did the new state become their permanent home?",
    help: "Leave blank if you don’t know yet — no deadline date will be calculated without it.",
    type: "date",
    required: false,
    showIf: (a) => a.domicileEstablished === "YES",
  },
  { id: "cdlHolder", label: "Does the driver hold a commercial driver’s license (CDL)?", type: "boolean", required: true },
  {
    id: "licenseKind",
    label: "What kind of CDL is it?",
    help: "A non-domiciled CDL is issued to a driver who is domiciled in a foreign country or in a State whose CDL program is decertified.",
    type: "select",
    options: [
      { value: "DOMICILED", label: "A regular CDL" },
      { value: "NON_DOMICILED", label: "A non-domiciled CDL" },
    ],
    required: true,
    showIf: (a) => a.cdlHolder === true,
  },
  { id: "hazmatEndorsement", label: "Does the CDL carry a hazardous materials endorsement?", type: "boolean", required: true, showIf: (a) => a.cdlHolder === true },
  {
    id: "medicalVariance",
    label: "Does the driver hold a medical variance, exemption or Skill Performance Evaluation certificate?",
    type: "boolean",
    required: true,
  },
  ...operationQuestions,
];

export const driverRelocation: WorkflowDefinition = {
  key: "DRIVER_RELOCATION",
  title: "Driver moves to another state",
  description: "Whether the driver’s State of domicile has changed, the 30-day CDL transfer, driving during the transfer, endorsements, medical records and what to ask the new State’s licensing agency.",
  driver: "existing",
  questions: relocationQuestions,
  validate(a) {
    const errors = validateAnswers(relocationQuestions, a);
    if (a.fromState && a.toState && a.fromState === a.toState) errors.toState = "Choose a different state from the one the driver is leaving.";
    return errors;
  },
  derive(a) {
    const cdl = a.cdlHolder === true;
    return {
      ...a,
      licenseKind: cdl ? a.licenseKind : "NONE",
      hazmatEndorsement: cdl ? a.hazmatEndorsement : false,
      domicileEstablishedOn: a.domicileEstablished === "YES" ? a.domicileEstablishedOn : undefined,
    };
  },
  warnings(a) {
    const w = operationWarnings(a);
    w.push("Only the federal rules are set out here. The new State’s own requirements — documents, tests, fees, and any deadline for an ordinary licence or vehicle registration — are not loaded: confirm them with that State’s licensing agency.");
    if (a.domicileEstablished === "YES" && !a.domicileEstablishedOn) w.push("Enter the date the new domicile was established to see the actual transfer deadline.");
    if (a.domicileEstablished === "UNKNOWN") w.push("Whether the driver’s domicile has changed decides whether the 30-day transfer period has started. Steps that depend on it are marked “Unable to determine”.");
    if (a.cdlHolder === true && a.licenseKind === "NON_DOMICILED") w.push("Non-domiciled CDLs follow different rules, which were not checked for this guide. That step is flagged for verification — confirm with the licensing agency before the driver moves.");
    return w;
  },
};

// ─────────────────────────────── Expand operations into another state ───────────────────────────────

const expansionQuestions: Question[] = [
  { id: "baseState", label: "In which state is the company based?", type: "state", options: STATE_OPTIONS, required: true },
  { id: "newState", label: "Which state are you expanding into?", type: "state", options: STATE_OPTIONS, required: true },
  {
    id: "currentScope",
    label: "Do your vehicles already cross state lines?",
    help: "If you have only ever operated inside your home state, crossing a state line for the first time makes you an interstate carrier.",
    type: "select",
    options: [
      { value: "ALREADY_INTERSTATE", label: "Yes — we already operate interstate" },
      { value: "INTRASTATE_ONLY_NOW", label: "No — we have only operated within our home state" },
    ],
    required: true,
  },
  {
    id: "intrastateInNewState",
    label: "Will you pick up and deliver loads wholly inside the new state?",
    help: "Hauling that starts and ends inside one state, and is not part of an interstate shipment, is regulated by that state.",
    type: "select",
    options: YNU,
    required: true,
  },
  {
    id: "forHire",
    label: "Are you paid to haul other people’s freight or passengers?",
    type: "select",
    options: [
      { value: "YES", label: "Yes — for-hire" },
      { value: "NO", label: "No — only our own goods (private carrier)" },
      { value: "UNKNOWN", label: "Not sure" },
    ],
    required: true,
  },
  {
    id: "hasAuthority",
    label: "Does the company hold active FMCSA operating authority (an MC number)?",
    type: "select",
    options: YNU,
    required: true,
    showIf: (a) => a.forHire === "YES",
  },
  { id: "hazmat", label: "Will you transport hazardous materials in quantities that require placards?", type: "boolean", required: true },
  { id: "oversize", label: "Will you move oversize or overweight loads?", type: "boolean", required: true },
  { id: "terminal", label: "Will you open a terminal, yard or office in the new state?", type: "boolean", required: true },
];

export const stateExpansion: WorkflowDefinition = {
  key: "STATE_EXPANSION",
  title: "Expand operations into another state",
  description: "What changes federally when you enter a new state, what stays the same, and the registration, fuel-tax, permit and State-authority questions to settle with the official agencies before the first trip.",
  driver: "optional",
  questions: expansionQuestions,
  validate(a) {
    const errors = validateAnswers(expansionQuestions, a);
    if (a.baseState && a.newState && a.baseState === a.newState) errors.newState = "Choose a different state from the one you are based in.";
    return errors;
  },
  derive(a) {
    const intrastateInNewState = a.intrastateInNewState === "YES" ? true : a.intrastateInNewState === "NO" ? false : "UNKNOWN";
    // Entering another State is interstate operation by definition (§ 390.5T).
    return { ...a, intrastateInNewState, hasAuthority: a.forHire === "YES" ? a.hasAuthority : "NOT_ASKED", operationType: "INTERSTATE" };
  },
  warnings(a) {
    const w: string[] = [];
    w.push("Most of what a new state requires is State law or a multi-State programme (IRP, IFTA) outside the federal regulations. Those steps are flagged for verification: they tell you what to ask the official agency, not what the answer is.");
    w.push("No fees, tax rates or State deadlines are quoted in this guide.");
    if (a.currentScope === "INTRASTATE_ONLY_NOW") w.push("This will be your first interstate operation, so the full federal safety regulations start to apply. Use the “Open a new trucking company” workflow alongside this one.");
    if (a.forHire === "YES" && a.hasAuthority === "NO") w.push("Do not haul a for-hire load across the state line until FMCSA operating authority has been issued.");
    if (a.intrastateInNewState === "YES") w.push("FMCSA operating authority does not authorize point-to-point hauling inside the new state. Ask that state’s motor carrier agency what it requires before taking an intrastate load there.");
    return w;
  },
};

export const WORKFLOWS: Record<WorkflowKey, WorkflowDefinition> = {
  STATE_EXPANSION: stateExpansion,
  DRIVER_RELOCATION: driverRelocation,
  AUDIT_NOTICE: auditNotice,
  NEW_CARRIER_STARTUP: newCarrierStartup,
  LEASED_EQUIPMENT: leasedEquipment,
  SHORT_HAUL_STATUS: shortHaulStatus,
  ELD_MALFUNCTION: eldMalfunction,
  DRIVER_CITATION: driverCitation,
  VEHICLE_MAINTENANCE: vehicleMaintenance,
  RANDOM_TEST_SELECTION: randomTestSelection,
  HIRE_CDL_DRIVER: hireCdlDriver,
  DOT_ACCIDENT_RESPONSE: dotAccidentResponse,
  DRUG_ALCOHOL_VIOLATION: drugAlcoholViolation,
  ROADSIDE_INSPECTION: roadsideInspection,
  HOS_VIOLATION: hosViolation,
  MEDICAL_CERT_EXPIRED: medicalCertExpired,
  CDL_DISQUALIFIED: cdlDisqualified,
  DRIVER_SEPARATION: driverSeparation,
};

export function labelsFor(def: WorkflowDefinition): Record<string, string> {
  const labels: Record<string, string> = Object.fromEntries(def.questions.map((q) => [q.id, q.label]));
  labels.dotAccident = "Meets the federal accident definition";
  labels.qualifyingNonFatal = "Injury treated away from scene or disabling-damage tow-away";
  labels.companyAlcoholPreEmploymentPolicy = "Company conducts pre-employment alcohol tests";
  labels.isViolation = "Part 382 violation";
  labels.employerReports = "Employer must report to Clearinghouse";
  labels.mroReports = "MRO reports to Clearinghouse";
  labels.reportHasViolations = "Report notes violations or an out-of-service condition";
  return labels;
}
