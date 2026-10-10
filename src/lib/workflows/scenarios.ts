import type { WorkflowKey } from "../rules/types";

/**
 * The scenario catalog behind "What are you trying to accomplish?".
 *
 * LIVE scenarios open a working workflow (sometimes with answers pre-filled).
 * PLANNED scenarios are shown honestly as not yet available; `regulatoryAreas`
 * lists where research starts — Part-level only, nothing asserted as a requirement.
 */

export type ScenarioStatus = "LIVE" | "PLANNED";

export interface Scenario {
  n: number;
  category: string;
  title: string;
  determines: string;
  status: ScenarioStatus;
  workflow?: WorkflowKey;
  /** Pre-filled questionnaire answers when a scenario is a variant of a live workflow. */
  preset?: Record<string, string | boolean>;
  phase?: 2 | 3 | 4;
  regulatoryAreas?: string[];
  /**
   * This entry duplicated another scenario (same workflow, same pre-filled answers) and
   * was merged into it. It is kept so its number and old links keep working, but it is
   * not listed or returned by search — its title is a search alias of the target.
   */
  aliasOf?: number;
}

const C1 = "Driver hiring & onboarding";
const C2 = "Driver qualification & employment changes";
const C3 = "Drug & alcohol compliance";
const C4 = "Accidents, roadside inspections & violations";
const C5 = "Vehicle & maintenance compliance";
const C6 = "Hours of service & dispatch";
const C7 = "Company & administrative compliance";

export const CATEGORIES = [C1, C2, C3, C4, C5, C6, C7];

export const SCENARIOS: Scenario[] = [
  { n: 1, category: C1, title: "Hire a brand-new CDL driver", determines: "Qualifications, documents, investigations, testing and approvals before dispatch.", status: "LIVE", workflow: "HIRE_CDL_DRIVER", preset: { experience: "NEW_LICENSE" } },
  { n: 2, category: C1, title: "Hire an experienced CDL driver", determines: "Prior-employer investigations, MVRs, Clearinghouse and DQ records.", status: "LIVE", workflow: "HIRE_CDL_DRIVER", preset: { experience: "EXPERIENCED" } },
  { n: 3, category: C1, title: "Hire a driver with less than one year of experience", determines: "Entry-level training, licensing, qualifications and company experience policies.", status: "LIVE", workflow: "HIRE_CDL_DRIVER", preset: { experience: "NEW_LICENSE" }, aliasOf: 1 },
  { n: 4, category: C1, title: "Rehire a former employee", determines: "Which hiring procedures must be repeated and which records remain usable.", status: "LIVE", workflow: "HIRE_CDL_DRIVER", preset: { experience: "RETURNING" } },
  { n: 5, category: C1, title: "Hire a driver licensed in another state", determines: "Licensing, medical qualification, employment and state obligations.", status: "LIVE", workflow: "HIRE_CDL_DRIVER" },
  { n: 6, category: C1, title: "Hire a non-CDL commercial driver", determines: "Which FMCSA rules apply without a CDL.", status: "PLANNED", phase: 2, regulatoryAreas: ["49 CFR Part 391", "49 CFR 390.5 (CMV definition)"] },
  { n: 7, category: C1, title: "Hire a driver with previous DOT violations", determines: "Clearinghouse status, return-to-duty requirements and eligibility.", status: "LIVE", workflow: "HIRE_CDL_DRIVER", preset: { priorViolation: "YES" } },
  { n: 8, category: C1, title: "Hire a driver with a recent accident", determines: "Background investigations, driving-record evaluation and qualification standards.", status: "LIVE", workflow: "HIRE_CDL_DRIVER", preset: { priorDotEmployment: "YES" } },
  { n: 9, category: C1, title: "Bring on an owner-operator", determines: "Qualification, testing, vehicle compliance and contractor documentation.", status: "PLANNED", phase: 3, regulatoryAreas: ["49 CFR Part 376 (leasing)", "49 CFR Parts 382, 391"] },
  { n: 10, category: C1, title: "Hire a driver who will operate in multiple states", determines: "Interstate applicability, qualifications, licensing and state obligations.", status: "LIVE", workflow: "HIRE_CDL_DRIVER", preset: { operationType: "INTERSTATE" } },

  { n: 11, category: C2, title: "Driver's medical certificate expires or has expired", determines: "Whether the driver can operate, how to get recertified, and how to verify and file the new certification.", status: "LIVE", workflow: "MEDICAL_CERT_EXPIRED" },
  { n: 12, category: C2, title: "Driver's CDL expires", determines: "Immediate operating restrictions and steps before returning to driving.", status: "LIVE", workflow: "CDL_DISQUALIFIED", preset: { licenseEvent: "EXPIRED" } },
  { n: 13, category: C2, title: "Driver receives a speeding ticket", determines: "Driver notification obligations, employer review and disqualification implications.", status: "LIVE", workflow: "DRIVER_CITATION", preset: { stage: "CITED" } },
  { n: 14, category: C2, title: "Driver arrested for DUI while off duty", determines: "CDL reporting obligations, disqualification and employer responsibilities.", status: "LIVE", workflow: "DRIVER_CITATION", preset: { offense: "DUI", vehicle: "PERSONAL" } },
  { n: 15, category: C2, title: "Driver hasn't completed qualification paperwork", determines: "Whether operation is permissible and which records need completion.", status: "PLANNED", phase: 2, regulatoryAreas: ["49 CFR Part 391"] },
  { n: 16, category: C2, title: "Driver transfers from local to OTR", determines: "Hours-of-service, ELD, qualification and operational changes.", status: "LIVE", workflow: "SHORT_HAUL_STATUS", preset: { pattern: "PERMANENT" } },
  { n: 17, category: C2, title: "Driver moves to another state", determines: "CDL domicile, record updates and licensing deadlines.", status: "LIVE", workflow: "DRIVER_RELOCATION" },
  { n: 18, category: C2, title: "Driver returns after a six-month absence", determines: "Which checks and tests must be reviewed before dispatch.", status: "PLANNED", phase: 2, regulatoryAreas: ["49 CFR Part 382 Subpart C", "49 CFR Part 391"] },

  { n: 19, category: C3, title: "Driver tests positive on a DOT drug test", determines: "Immediate removal, Clearinghouse reporting, SAP process and return-to-duty.", status: "LIVE", workflow: "DRUG_ALCOHOL_VIOLATION", preset: { violationType: "POSITIVE_DRUG" } },
  { n: 20, category: C3, title: "Driver refuses a DOT drug test", determines: "What counts as a refusal, restrictions, reporting and follow-up.", status: "LIVE", workflow: "DRUG_ALCOHOL_VIOLATION", preset: { violationType: "REFUSAL" } },
  { n: 21, category: C3, title: "Driver involved in an accident — is testing required?", determines: "Whether post-accident testing applies and the time limits.", status: "LIVE", workflow: "DOT_ACCIDENT_RESPONSE", aliasOf: 26 },
  { n: 22, category: C3, title: "Driver selected for random testing is unavailable", determines: "Selection handling, notification and documentation.", status: "LIVE", workflow: "RANDOM_TEST_SELECTION" },
  { n: 23, category: C3, title: "Start the company's first DOT drug-testing program", determines: "Program setup, policy, testing arrangements, consortium and records.", status: "PLANNED", phase: 2, regulatoryAreas: ["49 CFR Part 382", "49 CFR Part 40"] },
  { n: 24, category: C3, title: "Driver has a prior Clearinghouse violation", determines: "Whether the driver is prohibited and which return-to-duty steps apply.", status: "LIVE", workflow: "HIRE_CDL_DRIVER", preset: { priorViolation: "YES" }, aliasOf: 7 },
  { n: 25, category: C3, title: "Driver admits using a prohibited substance", determines: "Whether the admission triggers the DOT violation process.", status: "LIVE", workflow: "DRUG_ALCOHOL_VIOLATION", preset: { violationType: "ACTUAL_KNOWLEDGE" } },

  { n: 26, category: C4, title: "Driver involved in an accident", determines: "Emergency response, whether testing is required, accident register, record preservation and reporting.", status: "LIVE", workflow: "DOT_ACCIDENT_RESPONSE" },
  { n: 27, category: C4, title: "Driver placed out of service", determines: "What must stop, the driver's and carrier's deadlines, and when the driver may drive again.", status: "LIVE", workflow: "ROADSIDE_INSPECTION", preset: { driverOos: true } },
  { n: 28, category: C4, title: "Truck fails a roadside inspection", determines: "Repairs, the 15-day certification, returning the report and the record to keep.", status: "LIVE", workflow: "ROADSIDE_INSPECTION" },
  { n: 29, category: C4, title: "Driver cited for an hours-of-service violation", determines: "Record review, exceptions, corrective action and the roadside report.", status: "LIVE", workflow: "HOS_VIOLATION", preset: { situation: "EXCEEDED", foundBy: "ROADSIDE" } },
  { n: 30, category: C4, title: "Driver strikes a bridge or overhead obstruction", determines: "Accident reporting, vehicle inspection and possible state notifications.", status: "LIVE", workflow: "DOT_ACCIDENT_RESPONSE", aliasOf: 26 },
  { n: 31, category: C4, title: "Truck involved in a fatal accident", determines: "Investigations, preservation, testing and federal/state reporting.", status: "LIVE", workflow: "DOT_ACCIDENT_RESPONSE", preset: { fatality: true, onlyBoardingOrCargo: false } },
  { n: 32, category: C4, title: "Driver stopped without required documentation", determines: "Which records must be carried and how to resolve the deficiency.", status: "LIVE", workflow: "ROADSIDE_INSPECTION", preset: { vehicleOos: false, driverOos: false, violationsFound: "YES", missingDocs: true } },
  { n: 33, category: C4, title: "FMCSA compliance investigation notice received", determines: "Document preparation, record verification and corrective action planning.", status: "PLANNED", phase: 3, regulatoryAreas: ["49 CFR Part 385", "49 CFR 390.15"] },

  { n: 34, category: C5, title: "Purchase a new commercial truck", determines: "Registration, insurance, inspections, equipment and permits.", status: "LIVE", workflow: "VEHICLE_MAINTENANCE", preset: { situation: "NEW_UNIT", unitType: "POWER" } },
  { n: 35, category: C5, title: "Annual DOT inspection expires", determines: "Whether the vehicle may operate and how to inspect and document.", status: "LIVE", workflow: "VEHICLE_MAINTENANCE", preset: { situation: "ANNUAL_EXPIRED" } },
  { n: 36, category: C5, title: "Driver reports defective brakes", determines: "OOS criteria, repairs and documentation before return to service.", status: "LIVE", workflow: "VEHICLE_MAINTENANCE", preset: { situation: "DEFECT_REPORTED", defectAffectsSafety: "YES" } },
  { n: 37, category: C5, title: "Lease a truck temporarily", determines: "Lease documentation, responsibility, insurance and vehicle records.", status: "LIVE", workflow: "LEASED_EQUIPMENT" },
  { n: 38, category: C5, title: "Truck breaks down during a delivery", determines: "Roadside safety, repairs, towing and safe return to operation.", status: "LIVE", workflow: "VEHICLE_MAINTENANCE", preset: { situation: "BREAKDOWN", unitType: "POWER" } },
  { n: 39, category: C5, title: "Add a trailer to the fleet", determines: "Inspection, maintenance, registration and equipment requirements.", status: "LIVE", workflow: "VEHICLE_MAINTENANCE", preset: { situation: "NEW_UNIT", unitType: "TRAILER" } },
  { n: 40, category: C5, title: "Maintenance records are missing", determines: "Reconstruction, current compliance verification and corrective action.", status: "LIVE", workflow: "VEHICLE_MAINTENANCE", preset: { situation: "RECORDS_MISSING" } },

  { n: 41, category: C6, title: "Driver is out of available driving hours", determines: "Whether an exception applies and what dispatcher and driver must do.", status: "LIVE", workflow: "HOS_VIOLATION", preset: { situation: "ABOUT_TO" } },
  { n: 42, category: C6, title: "Driver's ELD stops working", determines: "Malfunction documentation, replacement deadlines and alternate records.", status: "LIVE", workflow: "ELD_MALFUNCTION" },
  { n: 43, category: C6, title: "Local driver exceeds short-haul limits", determines: "Which records become necessary and whether ELD use is required.", status: "LIVE", workflow: "SHORT_HAUL_STATUS", preset: { pattern: "ONE_DAY" } },
  { n: 44, category: C6, title: "Driver operates in adverse weather", determines: "Whether the adverse-driving-conditions exception applies.", status: "LIVE", workflow: "HOS_VIOLATION", preset: { cause: "ADVERSE" } },
  { n: 45, category: C6, title: "Driver does both local and OTR work", determines: "HOS records, ELD requirements and exemption eligibility.", status: "LIVE", workflow: "SHORT_HAUL_STATUS", preset: { pattern: "MIXED" } },
  { n: 46, category: C6, title: "Dispatcher asks a driver to exceed legal hours", determines: "Responsibilities, prohibited conduct and escalation.", status: "LIVE", workflow: "HOS_VIOLATION", preset: { situation: "ABOUT_TO", cause: "DISPATCH" } },

  { n: 47, category: C7, title: "Open a new trucking company", determines: "USDOT registration, authority, insurance, testing program and startup requirements.", status: "LIVE", workflow: "NEW_CARRIER_STARTUP" },
  { n: 48, category: C7, title: "Expand operations into another state", determines: "Authority, registration, permits, fuel tax and state rules.", status: "LIVE", workflow: "STATE_EXPANSION" },
  { n: 49, category: C7, title: "DOT audit notice received", determines: "Required documents, review periods, deficiencies and preparation.", status: "LIVE", workflow: "AUDIT_NOTICE" },
  { n: 50, category: C7, title: "Driver leaves the company (quits or is terminated)", determines: "Record retention, Clearinghouse reporting and answering the next employer.", status: "LIVE", workflow: "DRIVER_SEPARATION" },

  // Added in catalog 2026.10.1 (numbers continue so existing links to scenarios 1-50 keep working).
  { n: 51, category: C4, title: "Vehicle placed out of service", determines: "What may not move, the repairs required, and certifying the corrections.", status: "LIVE", workflow: "ROADSIDE_INSPECTION", preset: { vehicleOos: true } },
  { n: 52, category: C6, title: "Driver exceeds hours-of-service limits", determines: "Stopping the driver, checking for an exception, and keeping the log accurate.", status: "LIVE", workflow: "HOS_VIOLATION", preset: { situation: "EXCEEDED" } },
  { n: 53, category: C2, title: "Driver's CDL is suspended, revoked or disqualified", determines: "Taking the driver off the road, required notifications, and verifying reinstatement.", status: "LIVE", workflow: "CDL_DISQUALIFIED", preset: { licenseEvent: "SUSPENDED_REVOKED" } },
];

// ─────────────── Compliance-guide grouping (display only; `category` above is unchanged) ───────────────

export const GUIDE_CATEGORIES = [
  "Hiring and Driver Qualifications",
  "Drug and Alcohol Compliance",
  "Accidents and Roadside Inspections",
  "Hours of Service",
  "Vehicle Maintenance and Inspections",
  "Company Registration and Operations",
  "State-Specific Requirements",
] as const;
export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];

const GUIDE_CATEGORY_OF: Record<string, GuideCategory> = {
  [C1]: "Hiring and Driver Qualifications",
  [C2]: "Hiring and Driver Qualifications",
  [C3]: "Drug and Alcohol Compliance",
  [C4]: "Accidents and Roadside Inspections",
  [C5]: "Vehicle Maintenance and Inspections",
  [C6]: "Hours of Service",
  [C7]: "Company Registration and Operations",
};
/** Scenarios whose substance is mainly a state question. */
const STATE_SPECIFIC = new Set([17, 48]);

export function guideCategory(s: Scenario): GuideCategory {
  if (STATE_SPECIFIC.has(s.n)) return "State-Specific Requirements";
  // Hours-of-service citations live with HOS rather than roadside events.
  if (s.n === 29) return "Hours of Service";
  return GUIDE_CATEGORY_OF[s.category];
}

/** Large shortcut tiles on the home page. */
export const FEATURED: Array<{ n: number; label: string }> = [
  { n: 1, label: "Hiring a Driver" },
  { n: 26, label: "Driver Accident" },
  { n: 19, label: "DOT Drug Test" },
  { n: 28, label: "Roadside Inspection" },
  { n: 41, label: "Hours of Service" },
  { n: 35, label: "Vehicle Maintenance" },
];

export function getScenario(n: number | string): Scenario | undefined {
  return SCENARIOS.find((s) => String(s.n) === String(n));
}

/** Scenarios shown to users (merged duplicates excluded). */
export const VISIBLE_SCENARIOS: Scenario[] = SCENARIOS.filter((s) => s.aliasOf === undefined);

/** Follow a merged scenario to the one it was merged into. */
export function resolveScenario(s: Scenario): Scenario {
  return (s.aliasOf !== undefined && getScenario(s.aliasOf)) || s;
}

/** Merged scenarios whose titles and keywords act as search aliases for `n`. */
export function aliasesOf(n: number): Scenario[] {
  return SCENARIOS.filter((s) => s.aliasOf === n);
}
