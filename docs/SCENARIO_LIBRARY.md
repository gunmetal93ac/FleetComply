# Scenario library — status and development checklist

Working record for expanding the FleetComply compliance scenario library. Update this file at the end of every batch so the next session can continue from here.

**Last updated:** 2026-10-10 (batch 3) · **Catalog:** 2026.10.3 · **Scenarios:** 49 shown to users (43 with a step-by-step workflow, 6 not yet developed), plus 4 merged duplicates kept as search aliases — 53 entries in total · **Workflows:** 18 · **Rules:** 246 (208 verified, 38 flagged "Requires Regulatory Verification")

These figures come from the code — recompute them (see "Technical notes") rather than editing by hand.

| Workflow | Rules | Verified | Needs review | Questions | Scenarios |
|---|---|---|---|---|---|
| `HIRE_CDL_DRIVER` | 27 | 22 | 5 | 17 | 1, 2, 4, 5, 7, 8, 10 |
| `DOT_ACCIDENT_RESPONSE` | 14 | 11 | 3 | 10 | 26, 31 |
| `DRUG_ALCOHOL_VIOLATION` | 11 | 11 | 0 | 3 | 19, 20, 25 |
| `ROADSIDE_INSPECTION` (batch 1, +1 rule in batch 2) | 17 | 14 | 3 | 10 | 27, 28, 32, 51 |
| `HOS_VIOLATION` (batch 1, +1 rule in batch 2) | 10 | 9 | 1 | 7 | 29, 41, 44, 46, 52 |
| `MEDICAL_CERT_EXPIRED` (batch 1) | 8 | 8 | 0 | 5 | 11 |
| `CDL_DISQUALIFIED` (batch 1) | 9 | 7 | 2 | 7 | 12, 53 |
| `DRIVER_SEPARATION` (batch 1) | 9 | 8 | 1 | 5 | 50 |
| `SHORT_HAUL_STATUS` (batch 2) | 8 | 8 | 0 | 5 | 16, 43, 45 |
| `ELD_MALFUNCTION` (batch 2) | 7 | 7 | 0 | 6 | 42 |
| `DRIVER_CITATION` (batch 2) | 11 | 10 | 1 | 9 | 13, 14 |
| `VEHICLE_MAINTENANCE` (batch 2) | 16 | 14 | 2 | 8 | 34, 35, 36, 38, 39, 40 |
| `RANDOM_TEST_SELECTION` (batch 2) | 7 | 5 | 2 | 2 | 22 |
| `LEASED_EQUIPMENT` (batch 3) | 19 | 18 | 1 | 9 | 37 |
| `NEW_CARRIER_STARTUP` (batch 3) | 19 | 14 | 5 | 9 | 47 |
| `AUDIT_NOTICE` (batch 3) | 23 | 21 | 2 | 9 | 49 |
| `DRIVER_RELOCATION` (batch 3) | 12 | 10 | 2 | 10 | 17 |
| `STATE_EXPANSION` (batch 3) | 19 | 11 | 8 | 9 | 48 |

"Verified" means the rule text was checked by the developer against a paragraph-level extraction of the eCFR. No rule has had an independent human regulatory review; that is recorded separately in the Regulatory Intelligence dashboard (`RuleReview`) and is empty.

**Still undeveloped (6):** 6 non-CDL hire · 9 owner-operator · 15 incomplete qualification paperwork · 18 driver returns after a six-month absence · 23 first DOT drug-testing program · 33 FMCSA compliance investigation notice.

## How the library is built

| Thing | Where | Notes |
|---|---|---|
| Scenarios (what the user picks) | `src/lib/workflows/scenarios.ts` | A scenario is a title + a workflow + optional pre-filled answers. Several scenarios can share one workflow. Numbers are stable — never renumber. |
| Workflows (questions + branching) | `src/lib/workflows/definitions.ts` | `questions` (with `showIf`), `validate`, `derive` (answers → facts), `warnings`. |
| Rules (the steps) | `src/lib/rules/catalog/*.ts` | One entry per requirement: action, reason, citation, deadline, documents, retention, exceptions, verification, `appliesWhen`. |
| Search vocabulary | `src/lib/search/keywords.ts` | Concepts (phrase → token) and per-scenario keywords. Add aliases here — do not create duplicate scenarios for alternative phrasing. |
| URL slugs | `src/lib/workflows/slugs.ts` | `/guide/<slug>?scenario=<n>` |
| Tests | `tests/*.test.ts` | `npm test`. Each batch adds a test file pinning its conditional logic. |

No database change is needed to add scenarios, workflows or rules. `npm run db:seed` republishes `RuleVersion` rows but is optional for the public guide.

### Rules for writing rules

1. **Read the current official text first.** Record `lastVerified` only for statements checked against it. Batch 1 was checked against a paragraph-level extraction of the eCFR versioner API (`https://www.ecfr.gov/api/versioner/v1/full/<date>/title-49.xml?part=<part>&section=<section>`), current through 2026-10-05.
2. **If it was not checked, say so.** Use `verificationStatus: "REQUIRES_VERIFICATION"` with a `verificationNote`. Never present it as established law.
3. **Commerce scope.** Parts 390–399 → `INTERSTATE_ONLY` (intrastate users get "Unable to determine" until a state pack is loaded). Parts 382 and 383 → `ALL_COMMERCE`.
4. **State requirements** use `stateDependent`; nothing state-specific is asserted until a state pack is researched and loaded (`src/lib/rules/state-registry.ts` — all 51 registered, none loaded).
5. **Legal vs. recommended.** `kind: "LEGAL"` only for what the cited text requires. Practical advice is `BEST_PRACTICE`.
6. **Prohibitions.** `blocksSafetySensitive` means "the driver must not perform safety-sensitive functions until this is done". For anything narrower (a vehicle, driving only) use `prohibits: "<what is prohibited>"` instead.
7. Never edit a published rule in place — bump `version` and append to `changeLog`.

## Batch 1 — complete (2026-10-09)

The 10 priority scenarios:

| # | Priority scenario | Scenario n | Workflow | Status |
|---|---|---|---|---|
| 1 | Hiring a new CDL driver | 1 (also 2, 5, 7, 8, 10) | `HIRE_CDL_DRIVER` | Live (existing) |
| 2 | Driver involved in an accident | 26 (also 31) | `DOT_ACCIDENT_RESPONSE` | Live (existing) |
| 3 | Driver placed out of service | 27 | `ROADSIDE_INSPECTION` | **New** |
| 4 | Vehicle placed out of service | 51 | `ROADSIDE_INSPECTION` | **New** |
| 5 | Driver tests positive for controlled substances | 19 (also 20, 25) | `DRUG_ALCOHOL_VIOLATION` | Live (existing) |
| 6 | Driver medical certificate expires | 11 | `MEDICAL_CERT_EXPIRED` | **New** |
| 7 | Driver exceeds hours-of-service limits | 52 (also 29, 41) | `HOS_VIOLATION` | **New** |
| 8 | Truck fails a roadside inspection | 28 | `ROADSIDE_INSPECTION` | **New** |
| 9 | Driver's CDL is suspended | 53 (also 12) | `CDL_DISQUALIFIED` | **New** |
| 10 | Driver leaves the company | 50 | `DRIVER_SEPARATION` | **New** |

### eCFR sections read for batch 1

§§ 382.401, 382.705, 383.31, 383.33, 383.37, 383.51 (a) and (e), 383.71 (b)(1), (h), 383.73 (o), 391.11, 391.15, 391.23 (e)–(m), 391.41 (a), 391.45, 391.51, 391.53, 392.5, 395.1 (b), (e)(1), 395.2 (adverse driving conditions), 395.3, 395.8 (a), (e), (k), 395.13, 395.30, 396.7, 396.9 (c), (d), 396.11 (a).

Changes found that differ from older guidance:

- **§ 396.9(d)(3)(ii)** — the completed roadside inspection form is returned only "if requested by the issuing State agency" (amended 2026, 91 FR 37056). It must still be certified within 15 days and kept 12 months.
- **Medical certification, CDL/CLP holders (§§ 391.23(m), 391.41(a)(2), 383.71(h), 383.73(o))** — from June 23, 2025 results are transmitted electronically; the CDLIS MVR is the proof; the 15-day paper-certificate option ended June 22, 2025; drivers no longer carry the certificate.

### Flagged for regulatory review (batch 1)

| Rule | Why |
|---|---|
| `REVIEW-DRIVER-OOS-REASON` | Only HOS, alcohol and licence/medical out-of-service reasons are modelled. |
| `BP-DATAQS-REVIEW` | DataQs procedure and time limits not checked against FMCSA guidance. |
| `REVIEW-395.5-PASSENGER-LIMITS` | Passenger-carrying limits (§ 395.5) not loaded. |
| `REVIEW-CDL-ALCOHOL-DRUG` | "Actual knowledge" definition (§ 382.107) not re-checked. |
| `FED-391.23M2-VERIFY-CDLIS` (note only) | Any current FMCSA waiver extending paper medical certificates is outside the CFR text and was not checked. |
| `STATE-ROADSIDE-FOLLOW-UP`, `STATE-CDL-REINSTATEMENT`, `STATE-SEP-EMPLOYMENT-LAW` | State-specific; no state packs loaded. |

Carried over from catalog 2026.10.0: `REVIEW-CLAIMED-EXEMPTION`, `EMP-I9`, `EMP-W4`, `EMP-STATE-WITHHOLDING-NEW-HIRE`, `EMP-WORKERS-COMP`, `FED-390.5-ACCIDENT-DETERMINATION` (§ 390.5 vs. temporary § 390.5T), `STATE-ACC-REPORT`, `BP-ACC-INTERNAL-REVIEW`.

Run `npm run catalog:check` for the live list.

## Duplicates — merged 2026-10-09 (owner approved)

Merged entries stay in `scenarios.ts` with `aliasOf: <n>` so their numbers and old links keep working. They are not listed on the home page or returned by search; their titles and keywords are search aliases of the target. To merge another, add `aliasOf` — do not delete the entry or renumber.

| Merged entry | Into | Why |
|---|---|---|
| 3 "Hire a driver with less than one year of experience" | 1 "Hire a brand-new CDL driver" | Same workflow, identical preset (`experience: NEW_LICENSE`). |
| 24 "Driver has a prior Clearinghouse violation" | 7 "Hire a driver with previous DOT violations" | Same workflow, identical preset (`priorViolation: YES`). |
| 21 "Driver involved in an accident — is testing required?" | 26 "Driver involved in an accident" | Same workflow, no preset. 26 was retitled from "…a serious accident". |
| 30 "Driver strikes a bridge or overhead obstruction" | 26 "Driver involved in an accident" | Same workflow, no preset. |

Still open (left as is by decision):

| Scenarios | Observation | Plan |
|---|---|---|
| 29 and 52 | Both "driver over hours"; 29 pre-selects "found at roadside". | Keep both. |
| 33 and 49 | "Compliance investigation notice" and "DOT audit notice" overlap (both undeveloped). | Decide scope when building Category 7. |
| 8 | Preset `priorDotEmployment: YES` does not reflect "recent accident". | Revisit when the hiring workflow gets an accident-history branch. |
| 24 (merged) | Its wording is about an existing driver, but it always opened the hiring workflow. | An existing driver found "prohibited" on a Clearinghouse query deserves its own scenario — see backlog, Category 2. |

## Batch 2 — complete (2026-10-09)

17 scenarios went live. Five new workflows, plus one rule each added to the hours-of-service and roadside workflows.

| Scenario n | Title | Workflow | Pre-filled answers |
|---|---|---|---|
| 4 | Rehire a former employee | `HIRE_CDL_DRIVER` | experience: returning |
| 13 | Driver receives a speeding ticket | `DRIVER_CITATION` | stage: cited |
| 14 | Driver arrested for DUI while off duty | `DRIVER_CITATION` | offence: DUI, personal vehicle |
| 16 | Driver transfers from local to OTR | `SHORT_HAUL_STATUS` | pattern: permanent |
| 22 | Driver selected for random testing is unavailable | `RANDOM_TEST_SELECTION` | — |
| 32 | Driver stopped without required documentation | `ROADSIDE_INSPECTION` | violations found, missing documents |
| 34 / 39 | Purchase a new truck / add a trailer | `VEHICLE_MAINTENANCE` | new unit (power / trailer) |
| 35 | Annual DOT inspection expires | `VEHICLE_MAINTENANCE` | annual expired |
| 36 | Driver reports defective brakes | `VEHICLE_MAINTENANCE` | defect, affects safety |
| 38 | Truck breaks down during a delivery | `VEHICLE_MAINTENANCE` | breakdown |
| 40 | Maintenance records are missing | `VEHICLE_MAINTENANCE` | records missing |
| 42 | Driver's ELD stops working | `ELD_MALFUNCTION` | — |
| 43 / 45 | Short-haul limits exceeded / both local and OTR | `SHORT_HAUL_STATUS` | one day / mixed |
| 44 | Driver operates in adverse weather | `HOS_VIOLATION` | cause: adverse conditions |
| 46 | Dispatcher asks a driver to exceed legal hours | `HOS_VIOLATION` | about to exceed, cause: dispatch |

### eCFR sections read for batch 2

§§ 382.107 (actual knowledge, safety-sensitive function), 382.305, 383.51 (b) Table 1 and (c) Table 2, 390.6, 390.21, 391.25, 392.7, 392.22, 393.95, 395.1 (e)(2), 395.22 (a), (g)–(i), 395.34, 396.3, 396.13, 396.17, 396.21, 396.23.

Things the current text says that differ from common assumptions:

- **§ 393.95** — spare fuses are no longer listed (paragraphs (b)–(e) are reserved). Required: fire extinguisher (5 B:C, or two 4 B:C; 10 B:C for placarded hazmat) and warning devices (three triangles or at least 6 fusees).
- **§ 390.21** — the eCFR shows the section suspended indefinitely (84 FR 40294) with § 390.21T in its place. Marking requirements are flagged for review, not asserted.
- **§ 382.107** — "actual knowledge" includes a traffic citation for driving *a CMV* under the influence. A DUI in a personal vehicle is not on the list; a conviction still disqualifies a CDL holder for at least 1 year under § 383.51(b).
- **§ 382.305** — a selected driver "must be tested during the selection period"; the text has no provision for an unavailable driver.
- **§ 395.1(e)(2)** — the non-CDL short-haul provision uses 14th-hour (5 days) and 16th-hour (2 days) limits and exempts the driver from § 395.3(a)(2), not from the driving limits.

### Flagged for regulatory review (batch 2)

| Rule | Why |
|---|---|
| `REVIEW-390.21-VEHICLE-MARKING` | § 390.21 suspended; § 390.21T not read. |
| `REVIEW-NEW-UNIT-REGISTRATION` | Registration, IRP, IFTA, insurance, Form 2290 — planning list from general knowledge, nothing checked. |
| `REVIEW-RANDOM-LONG-ABSENCE` | No rule in § 382.305; FMCSA guidance and § 382.301 not read. |
| `REVIEW-RANDOM-NO-SHOW` | Reporting duty checked (§ 382.705); refusal definitions in 49 CFR 40.191 / 40.261 not read. |
| `STATE-CITATION-CONSEQUENCES` | State-specific; anti-masking rule (§ 384.226) not read. |
| Notes on verified rules | § 396.19 inspector qualifications not read in detail; current-year random testing rate (Federal Register) not checked; whether a short-haul driver must carry the previous 7 days' records on a logging day is FMCSA guidance, not checked. |

Batch-1 item now answerable: `REVIEW-CDL-ALCOHOL-DRUG` was flagged because § 382.107 had not been read. It has now — the rule can be re-issued as verified (version 2) using the same wording as `FED-382.107-DUI-CMV-ACTUAL-KNOWLEDGE` / `FED-382.107-DUI-PERSONAL-VEHICLE`.

## Backlog — by category from the expansion brief

Legend: ✅ live · 🟡 partly covered by a live workflow · ⬜ not started

### 1. Driver hiring and qualification
✅ New / experienced / limited-experience hire · ✅ rehire (4) · ✅ previous DOT violations (hire) · ✅ expired medical certificate · ✅ CDL expiration or disqualification · ✅ tickets and convictions (13, 14) · ✅ termination and record retention · 🟡 DQ file requirements, road test, previous-employer investigations (inside hiring workflow) · 🟡 annual MVR review (§ 391.25, inside citation workflow) · ⬜ non-CDL hire (6) · ⬜ incomplete qualification paperwork / DQ file audit (15) · ⬜ driver returns after absence (18) · ✅ driver moves state (17) · ⬜ hiring a driver with a suspended/revoked CDL · ⬜ medical variances as a standalone scenario · ⬜ exemptions

### 2. Drug and alcohol
✅ Positive result · ✅ refusal · ✅ alcohol violations · ✅ post-accident testing (accident workflow) · ✅ random selection unavailable (22) · 🟡 pre-employment testing, Clearinghouse queries (hiring workflow) · 🟡 return-to-duty, follow-up (violation workflow) · ⬜ starting a testing program (23) · ⬜ reasonable suspicion testing · ⬜ supervisor training · ⬜ recordkeeping as a standalone scenario · ⬜ existing driver found "prohibited" on a Clearinghouse query

### 3. Accidents and incidents
✅ Fatal / injury / tow-away / hazmat / citation branches · ✅ testing determination · ✅ accident register · ⬜ preventability determinations · ⬜ driver qualification following an accident · 🟡 insurance notice (best-practice item only)

### 4. Roadside inspections and violations
✅ Driver OOS · ✅ vehicle OOS · ✅ report handling, corrective action, 15-day certification · ✅ missing driver documentation (32) · 🟡 Level I/II/III (one workflow; the level does not change the duties) · 🟡 DataQs (best practice, unverified) · ⬜ violation-specific guidance (brakes, tires, lighting — Part 393) · ⬜ ELD violations at roadside

### 5. Hours of service
✅ 11/14/30-minute/60-70 limits, 34-hour restart · ✅ adverse driving conditions (44) · ✅ emergency conditions · ✅ coercion (46) · ✅ short-haul (16, 43, 45) · ✅ ELD malfunction (42) · ✅ record accuracy and retention · 🟡 log corrections (§ 395.30, inside HOS workflow) · ⬜ sleeper berth (§ 395.1(g)) · ⬜ personal conveyance · ⬜ yard moves · ⬜ unassigned driving time (§ 395.32) · ⬜ supporting documents (§ 395.11) · ⬜ passenger-carrying limits (§ 395.5)

### 6. Vehicle maintenance and inspections
✅ Annual inspection (35) · ✅ DVIR / defect reported (36) · ✅ breakdown (38) · ✅ maintenance records (40) · ✅ new truck / trailer (34, 39) · ✅ emergency equipment (§ 393.95, new-unit branch) · 🟡 pre-trip (§§ 392.7, 396.13 — inside defect branch) · ✅ leased equipment (37) · ⬜ brake / tire / wheel standards (Part 393)

### 7. Company operations
✅ New carrier (47) · ✅ expand into another state (48) · ✅ audit, new-entrant audit and safety-rating notices (49) · 🟡 UCR, IRP, IFTA, State authority and permits (listed as questions for the official agency; nothing verified) · ⬜ compliance investigation notice (33) · ⬜ insurance filings in detail (Part 387 Subpart C)

### 8. State-specific
🟡 Structure exists: every workflow asks interstate/intrastate and the relevant state, and returns "Unable to determine" for state-dependent items. ⬜ No state pack has been researched or loaded. Start with one state end-to-end (suggest the owner's base state) before generalising.

## Batch 3 — complete for five scenarios (2026-10-10)

Five scenarios went live, each with its own workflow. No pre-filled answers.

| Scenario n | Title | Workflow | Guide address | Decides the result |
|---|---|---|---|---|
| 37 | Lease a truck temporarily | `LEASED_EQUIPMENT` | `/guide/lease-a-truck` | Which Part 376 regime applies (not subject / exempt / carrier-to-carrier / full lease) |
| 47 | Open a new trucking company | `NEW_CARRIER_STARTUP` | `/guide/start-a-trucking-company` | Interstate or intrastate, for-hire or private, vehicle weight, hazmat, CDL drivers |
| 49 | DOT audit notice received | `AUDIT_NOTICE` | `/guide/dot-audit` | Kind of review, who sent it, proposed rating, carrier class |
| 17 | Driver moves to another state | `DRIVER_RELOCATION` | `/guide/driver-moves-state` | Whether domicile has changed, CDL or not, endorsement, variance |
| 48 | Expand operations into another state | `STATE_EXPANSION` | `/guide/expand-to-another-state` | Already interstate or not, for-hire, authority held, intrastate hauling in the new State |

### eCFR sections read for batch 3

§§ 365.101T–365.109T, 366.1T–366.6T, 376.1, 376.2, 376.11, 376.12, 376.21, 376.22, 383.5, 383.37, 383.71 (c), (f), (h), 385.3, 385.11, 385.13, 385.15, 385.17, Part 385 Subpart D (385.301T–385.337), 385.403, 387.7, 387.9, 390.5T, 390.19T, 390.21T, 390.29, 391.11, 391.25, 391.41, 391.51, 392.2, 392.9a, 396.3, 396.17. All read as a paragraph-level extraction of the text current through 2026-10-05, not verbatim.

Things the current text says that differ from common assumptions:

- **No universal audit deadline.** Fixed periods exist only for a failed new-entrant audit (§ 385.319) and a proposed rating (§§ 385.13, 385.15); everything else is the date in the notice, plus the 48-hour record production rule (§ 390.29).
- **§ 390.19T** requires the MCS-150 update every 24 months; it contains no duty to update on entering a new State. The expansion workflow presents that update as best practice.
- **§ 383.71(c)** gives a CDL holder 30 days from establishing a new domicile to *apply* for a transfer. It does not say how long the old State's licence remains valid; the workflow says so and sends the user to both licensing agencies.
- **§ 392.9a** prohibits operating beyond the scope of authority granted. That FMCSA authority is not issued State by State is the statutory design, not text in the sections read — noted on the rule.
- Many registration sections are suspended with temporary "T" versions in effect; each affected rule says which version was read.

### Flagged for regulatory review (batch 3)

| Rule | Why |
|---|---|
| `STATE-LEASED-VEHICLE-REGISTRATION` | State registration, plates and permits for a leased unit — no state pack. |
| `STATE-STARTUP-BUSINESS-AND-INTRASTATE` | Business formation and intrastate authority — no state pack. |
| `REVIEW-387-PASSENGER-INSURANCE` | Passenger-carrier insurance sections (Part 387 Subpart B) not read. |
| `REVIEW-UCR-REGISTRATION`, `REVIEW-UCR-ON-EXPANSION` | Part 367 fee brackets, dates and who must register not checked. |
| `REVIEW-IRP-IFTA-HVUT`, `REVIEW-IRP-NEW-STATE`, `REVIEW-IFTA-NEW-STATE` | IRP, IFTA and the heavy vehicle use tax are outside Title 49; thresholds, procedures and fees not checked. |
| `REVIEW-OWNER-OPERATOR-TESTING` | Duty to designate a C/TPA checked (§ 382.705(b)(6)); the random-pool arrangement for a single-driver employer (§ 382.103) not read. |
| `BP-AUDIT-VERIFY-THE-NOTICE` | Practical guidance; FMCSA's current advice on fraudulent solicitations not checked. |
| `REVIEW-STATE-AGENCY-AUDIT` | State audits follow State procedure — no state pack. |
| `REVIEW-NON-DOMICILED-CDL` | Non-domiciled CDL provisions (§§ 383.23(b), 383.71(f)) read only in outline. |
| `STATE-NEW-STATE-LICENSING-PROCEDURE` | New State's licensing documents, tests, fees and deadlines — no state pack. |
| `STATE-INTRASTATE-AUTHORITY-IN-NEW-STATE`, `STATE-PERMITS-TAXES-SIZE-WEIGHT`, `STATE-OVERSIZE-OVERWEIGHT-PERMITS`, `STATE-HAZMAT-PERMITS-AND-ROUTES`, `STATE-TERMINAL-BUSINESS-REGISTRATION` | Entirely State law — no state pack. These list what to ask, not the answer. |
| Notes on verified rules | Operating-authority exemptions (Part 372), cabotage, Part 107 hazmat registration, Part 397 routing and TSA Part 1572 were not read and are named as such in the rules that touch them. |

No fees, tax rates or State deadlines appear in any batch 3 rule; a test enforces this for the expansion workflow's flagged items.

## Still to build — the remaining 6 scenarios

| Scenarios | Proposed workflow | Read first |
|---|---|---|
| 6 non-CDL hire; 15 incomplete qualification paperwork | DQ file / non-CDL hiring | §§ 390.5T (CMV definition), 391.21, 391.23 (a)–(d), 391.31, 391.33; the hiring catalog already covers the CDL path |
| 18 returns after absence | Driver status change | §§ 382.301, 382.701, 391.45 (g), 395.8 (j) |
| 23 first DOT drug-testing program | Program setup | §§ 382.103, 382.601, 382.603, 382.701, 382.711; Part 40 Subparts B, E (service agents) |
| 9 owner-operator | Likely a branch of `LEASED_EQUIPMENT` (lease with driver) plus hiring | § 376.12 in full; Part 390 Subpart G |
| 33 compliance investigation | Likely a preset of `AUDIT_NOTICE` (review type: compliance review) — check it is not a duplicate of 49 before enabling | Part 385 Subpart A, Part 386 (enforcement) |

Also queued: passenger-carrying HOS limits (§ 395.5), re-issue `REVIEW-CDL-ALCOHOL-DRUG` as verified, and a first state pack.
## Technical notes

- eCFR API rate-limits at roughly more than five parallel requests (HTTP 429) — fetch in small batches. Do not add extra query parameters (HTTP 400).
- Recompute the header figures with a short script over `VISIBLE_SCENARIOS`, `ALL_RULES`, `rulesFor()` and `WORKFLOWS` — do not tally by hand.
- The tracked-checklist flow (`/workflows/<slug>/start`, sign-in required) works for every workflow. Driver workflows need a driver record; company and vehicle workflows (`driver: "optional"` in the definition) do not.
- Questionnaire answers are one shared record (`src/lib/workflows/answer-store.ts`), keyed by workflow + scenario + question id and kept in the browser until a checklist is saved; the save page reads it instead of asking again. After saving, `WorkflowRun.answers` is the only copy. Never key answers on question text or option labels.
- Checklist display order and labels come from `src/lib/workflows/priority.ts` (five tiers; emergency layout for accidents, out-of-service orders, breakdowns and safety-affecting defects). It reads the rules and never changes them. Immediate-safety steps are a hand-kept list (`IMMEDIATE_SAFETY_RULE_IDS`) — add a rule id there when a new workflow has a scene-safety step. All checklist wording is in `CHECKLIST_LABELS` in the same file. Both screens render through `src/components/checklist/Checklist.tsx`. Covered by `tests/checklist-priority.test.ts`.
- The checkbox on a saved checklist is a shortcut through the existing status steps (`checkboxRequests` in `status.ts`): ticking submits the step for verification; it never verifies.
- Editing answers on a saved checklist goes through `src/lib/workflows/revise.ts`: existing steps are re-evaluated against their stored rule snapshot, nothing is deleted, and each change is written to the step history and the audit log. Covered by `tests/answer-transfer.test.ts`.
- `Deadline.anchor` currently supports `employmentStartDate`, `accidentAt`, `determinationAt`, `inspectionAt`, `noticeReceivedAt`, `malfunctionAt`, `domicileEstablishedOn`. Add new anchors in `src/lib/rules/types.ts`.
- A rule with `prohibits` that evaluates to "Unable to determine" is shown in the guide's prohibition box as "Possibly — not yet determined".
- After adding rules, run `npm.cmd run reg:sync -- --dry-run` and then `npm.cmd run reg:sync` so they join the Regulatory Intelligence dependency map (insert-only). Last run 2026-10-10: in sync at 119 provisions, 389 references.
- `tests/batch3.workflows.test.ts` covers the five batch 3 workflows.
- `tests/batch2.workflows.test.ts` fails if two visible live scenarios share a workflow and identical pre-filled answers (i.e. are duplicates).
