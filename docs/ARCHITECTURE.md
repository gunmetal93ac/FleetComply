# FleetComply — Architecture & Design (Phase 1)

> FleetComply explains regulations and tracks evidence. It is not legal advice, and an approved workflow is a record of human review — never a certification that a driver or company is compliant.

Contents
1. High-level architecture
2. Database schema
3. Regulatory rules engine
4. Feature map
5. Development roadmap
6. Screen designs
7. Workflow designs (hire a CDL driver, accident, drug & alcohol violation)
8. Security model
9. Regulatory maintenance process
10. What is and isn't built

---

## 1. High-level architecture

```
 Browser (Next.js React UI, Tailwind, shadcn-style components)
   │  server actions / route handlers (HTTPS, httpOnly session cookie)
   ▼
 Next.js server (App Router, Node runtime)
   ├─ auth/        session tokens (hashed), scrypt passwords, TOTP MFA, RBAC
   ├─ tenant/      TenantRepository — injects orgId into every query
   ├─ runs.ts      workflow service: create run, item actions, approval
   ├─ storage/     StorageAdapter (dev: AES-256-GCM local disk; prod: S3 + KMS, planned)
   └─ rules/  ◄── framework-free domain core (also used by tests + seed)
        ├─ catalog/         versioned rule entries with citations & verification metadata
        ├─ engine.ts        3-valued applicability evaluation, deadlines, state gates
        └─ state-registry   51 jurisdiction packs (all NOT_LOADED in Phase 1)
      workflows/
        ├─ definitions.ts   questionnaires, validation, fact derivation, warnings
        ├─ checklist.ts     answers → personalized checklist (pure)
        ├─ status.ts        item state machine + segregation of duties
        ├─ review.ts        run summary, approval gate, readiness score
        └─ scenarios.ts     the 50-scenario catalog (live vs planned)
   ▼
 PostgreSQL (Prisma)           Object storage (encrypted)
```

Design choices

- **Domain core is pure TypeScript.** The rules engine, checklist generation, status transitions and approval gate have no framework or database imports, so they are unit-tested directly (63 tests) and reused by the seed script and, later, the AI assistant.
- **Rules are data, not code paths.** Each requirement is a catalog entry with declarative `appliesWhen` conditions. Adding a scenario means adding entries and a questionnaire, not new branching logic.
- **Checklist items snapshot their rule.** A run stores the exact rule version it evaluated (`ruleSnapshot`, `ruleVersion`, `catalogVersion`). Publishing a new rule version never rewrites history.
- **Monolith first.** Next.js server actions and route handlers are enough for Phase 1. A separate service is justified later for the regulatory-change monitor and notification workers (queues, schedules).

## 2. Database schema

Full definition: `prisma/schema.prisma`.

| Table | Purpose | Key columns |
|---|---|---|
| Organization | Tenant | name, usdotNumber, baseState, preEmploymentAlcoholTesting, isSample |
| User | People in a tenant | orgId, email, role (OWNER…VIEWER), passwordHash (scrypt), mfaEnabled, mfaSecret |
| Session | Server-side sessions | tokenHash (SHA-256 of cookie), mfaPending, expiresAt, ip, userAgent |
| Driver | Driver profile | orgId, status, cdlState/Class, endorsements[], cdlNumberLast4, cdlExpiresOn, medCertExpiresOn |
| WorkflowRun | One use of a workflow | orgId, workflowKey, driverId, answers, facts, warnings, catalogVersion, status, approvedBy/At/Note |
| ChecklistItem | One requirement in a run | orgId, runId, ruleId, ruleVersion, ruleSnapshot, classification, reasons, blocksSafetySensitive, status, dueAt, assignee, completion/verification fields, naReason, overrideFlag |
| ItemEvent | Append-only item history | orgId, itemId, actorId, kind, from/toStatus, note, at |
| Document | Evidence file metadata | orgId, driverId, runId, itemId, recordCategory, sha256, storageKey, version, supersedesId, expiresOn, retainUntil |
| AuditLog | Security & compliance audit trail | orgId, actorId, action, entity, meta, ip, at |
| RuleVersion | Published, immutable rule versions (global) | ruleId+version unique, snapshot, verificationStatus |
| RegulatoryChange | Phase 3 review queue (schema only) | source, summary, status, reviewer |

Every tenant table has `orgId` with an index; `recordCategory` keeps the DQ file, investigation history file (49 CFR 391.53), drug & alcohol records (382.401) and HR records separate.

## 3. Regulatory rules engine

### Rule entry (catalog)

Each entry carries every field the spec requires:

| Field | Example |
|---|---|
| id / version / changeLog | `FED-382.301-PRE-EMPLOYMENT-DRUG-TEST` v1 |
| kind | LEGAL · BEST_PRACTICE · COMPANY_POLICY |
| authority / jurisdiction | FMCSA / FEDERAL |
| commerceScope | INTERSTATE_ONLY · ALL_COMMERCE · NOT_COMMERCE_BASED |
| stateDependent | `{ stateFact, topic }` for state-set obligations |
| sources | citation + official URL (eCFR for Title 49) |
| appliesWhen | declarative condition tree |
| purpose, applicability, requiredAction[], documentation[] | plain-language content |
| deadline | description + optional anchor (`employmentStartDate`, `accidentAt`, `determinationAt`) and offset (hours / days / business days) |
| retention[] | per record type, with citation |
| exceptions, verification | text |
| blocksSafetySensitive, warning | drives the "cannot drive yet" guard |
| effectiveDate, lastVerified, verificationStatus, verificationNote | traceability |

### Evaluation

```
answers ──derive()──► facts ──► for each rule in workflow:
   appliesWhen (Kleene 3-valued: true / false / unknown)
     unknown → UNABLE_TO_DETERMINE ("missing: …")
     false   → NOT_APPLICABLE ("not applicable because …")
     true    → commerce gate: INTERSTATE_ONLY + intrastate
                 → state pack adopts it? → required (cites state)
                 → otherwise UNABLE_TO_DETERMINE
             → state gate: stateDependent + pack not loaded → UNABLE_TO_DETERMINE
             → kind: LEGAL → LEGALLY_REQUIRED (unconditional) / CONDITIONALLY_REQUIRED
                     BEST_PRACTICE / COMPANY_POLICY
   + computed dueAt from anchor fact
   + REQUIRES_VERIFICATION reason when the source wasn't re-verified
```

Properties that are tested:
- An unknown answer never silently evaluates to "not required".
- Federal interstate rules are never assumed for intrastate operations; Part 382 (CDL drug & alcohol) is applied to both.
- Best practices and company policy never appear as legal requirements.
- Deadlines and retention differ per item; business-day deadlines skip weekends (holidays are not yet modeled, so the computed date is never later than the legal one).

### Catalog integrity

`validateCatalog()` (run by tests, the seed script and `npm run catalog:check`) fails if any rule lacks a citation, an official https source for a federal legal rule, a verification date for VERIFIED entries, a reason for REQUIRES_VERIFICATION entries, actions, retention, a verification method, or a change log ending at the current version.

### Verification status in this release (catalog 2026.10.0)

Title 49 entries were checked against eCFR "current" text on 2026-10-08: 49 CFR 391.11, .21, .23, .25, .31, .33, .41, .51, .53; 382.209, .301, .305, .401, .501, .503, .505, .601, .701, .705; 383.93; 380.603; 390.5/390.5T, 390.15; 172.704; 171.15, 171.16; 40.191, 40.287, 40.305, 40.307. Sections cited only as cross-references (391.15, 391.43, Subpart G 391.61–.69, 40.25) were not separately fetched; the entries' requirements rest on the sections listed above.

Flagged **Requires Regulatory Verification** (8): exemption review (always human), I-9, W-4, state withholding/new-hire reporting, workers' comp, state crash reports, the crash-preventability program, and the accident definition — eCFR shows § 390.5 suspended effective 2026-07-21 alongside § 390.5T (91 FR 45661); the definition text matched, but which designation is in force must be confirmed before citing.

## 4. Feature map

| Area | Phase 1 (this build) | Later |
|---|---|---|
| Auth & tenancy | Register company, login, sessions, TOTP MFA, 6 roles, tenant-scoped repository, audit log | SSO, email invites, password reset, session management UI |
| Workflows | Hire a CDL driver; accident response; drug & alcohol violation; 50-scenario catalog with presets | Remaining 34 planned scenarios (phases listed in-app) |
| Checklist | Classification, reasons, full requirement detail, status machine, verification by a second person, N/A with reason, blocked, assign, deadlines, notes, history, uploads | Bulk actions, comments, item templates |
| Review | Run summary, blockers, overdue, undetermined, overrides, approval with note & disclaimer, reopen | E-signature |
| Reports | Printable audit report (browser PDF), CSV export | Server-side PDF, fleet-wide DQ review, missing-documents, audit findings |
| Dashboard | Explained readiness score, overdue, due ≤30 days, D&A tasks, undetermined, DQ status, med cert & CDL expirations, open accident investigations, filters (driver, category, assignee) | Annual reviews, vehicles, location/department filters |
| Documents | Encrypted upload, auto-association to requirement record type, versioning, expiration date, access restrictions for sensitive records, download audit | Retention scheduling & deletion workflow, templates, OCR |
| Regulatory library | Searchable catalog with verification badges, citations, version history, state-pack status | State packs, change monitor, diff view, approval queue |
| Notifications | Dashboard only | Configurable 90/60/30/7-day reminders, email/SMS |
| AI assistant | — | Retrieval over approved catalog only, citations, uncertainty |

## 5. Development roadmap

**Phase 1 — this build.** Everything in the Phase 1 column above.

**Phase 2 — state rules, ongoing driver compliance, vehicles.**
1. State pack research pipeline: one pack per jurisdiction with intrastate adoption of Parts 382/391 (and tolerances under 49 CFR 350), new-hire reporting, crash reporting, workers' comp; each entry reviewed and approved before `status: LOADED`. Start with the states your customers operate in.
2. Annual driver qualification workflow (391.25 annual MVR inquiry and review; 382.701(b) annual Clearinghouse query).
3. Expiration alerts (CDL, medical certification, document `expiresOn`) with configurable schedules; notification outbox table + worker.
4. Vehicle profiles and workflows (annual inspection, defects/repairs, OOS/return to service).
5. Compliance calendar; rehire, non-CDL hire, termination & record-retention workflows; scenarios #11–18, 22–23, 27–28, 34–36, 39, 50.

**Phase 3 — assistant, change monitoring, audits, scale.**
1. Regulatory change monitor: poll eCFR/Federal Register for cited parts, create `RegulatoryChange` rows, map to affected rules and open runs; human approval publishes a new rule version; open runs get a "rule updated — review" flag (never silently rewritten).
2. AI assistant (Anthropic API) using retrieval over approved `RuleVersion` rows only; answers must cite rule ids and show verification status; declines when the catalog has no entry.
3. Audit preparation reports, server-side PDF, fleet-wide DQ file review.
4. Advanced permissions (per-location scopes), multi-company management, S3 adapter with SSE-KMS and signed URLs, Postgres row-level security as a second isolation layer.
5. Hours-of-service, ELD and company-formation scenarios.

## 6. Screen designs

All screens use a left sidebar (Dashboard, Compliance Workflows, Drivers, Vehicles*, Documents, Compliance Calendar*, Regulatory Library, AI Assistant*, Reports, Settings; *planned and labeled as such) and collapse to a top menu on mobile.

**Dashboard** — quick-start buttons for the three live workflows (one click to a questionnaire), filter bar, readiness score card with its formula and disclaimer, cards for overdue, due soon, D&A tasks, needs-a-decision, DQ status per driver, medical/CDL expirations, open accident investigations, and a "not tracked yet" card.

**What are you trying to accomplish?** — the 50 scenarios in seven categories. Live cards are links (with presets, e.g. "Driver refuses a DOT drug test" pre-selects *Refusal*); planned cards are greyed, show their phase and research starting points, and are not clickable.

**Questionnaire** — progress bar, driver section (new name, or pick an existing driver), situation questions with help text, conditional questions appear only when relevant, inline validation, "Build my checklist".

**Checklist (run) page** — summary bar (resolved count, blockers, overdue, needs-decision, awaiting verification, "do not allow safety-sensitive functions…" warning, final-review panel); left: filterable list grouped by stage with status/classification/blocker/due badges; right: the selected requirement — warnings, Requires-Verification notice, *Why this is on your checklist*, purpose, applicability, required action, documentation, deadline (with computed due date), retention table, regulatory reference links, exceptions, how to verify, status actions, responsible person, internal deadline, notes, evidence upload, history.

**Report** — printable: header with company/run/catalog version, stats, potential compliance issues, situation notes, sections for completed (verified), awaiting verification, missing, user-N/A overrides, engine-N/A list, reviewer/approval with disclaimer.

## 7. Workflow designs

### Hire a new CDL driver (scenarios 1–3, 5, 7, 8, 10, 24)

Questions: company/license/operating states; interstate vs intrastate; CDL vehicle; class; hazmat; passengers; tank or doubles; DOT testing (checked against Part 382); experience; prior DOT employment (3 yrs); non-FMCSA DOT employers; prior violation; 382.301(b) exception; exemption; start date.

Stages and items (classification depends on answers):

| Stage | Items |
|---|---|
| Driver qualification | 391.11 general qualifications · 391.21 application (10-yr history for CDL) · 383.93 class & endorsements · 391.23(a)(1) MVRs (30 days) · 391.23 safety performance history (30 days) *or* documentation of no prior DOT employment · 391.51(b)(6) medical certification via CDLIS MVR · 391.33 CDL-in-lieu *or* 391.31 road test for tank/doubles · 391.51 DQ file · ELDT check (best practice) · exemption review |
| Drug & alcohol | 391.23(f) consent · 382.701 pre-employment full query · non-FMCSA DOT history request · 382.301 pre-employment drug test *or* documented exception · pre-employment alcohol (company policy) · prior violation RTD/follow-up · 382.601 policy receipt · 382.305 random pool |
| Hazardous materials | 172.704 training (90 days, supervised until then) |
| Employment & administrative (not DQ file) | I-9 · W-4 · state withholding & new-hire report · workers' comp · company acknowledgments |

Blocking items (driver may not perform safety-sensitive functions until **verified**): general qualifications, application, CDL class/endorsements, medical certification, road test/equivalent, consent, Clearinghouse query, pre-employment drug test or exception, prior-violation RTD, company alcohol test, exemption review.

### Accident involving one of our drivers (scenarios 21, 26, 30, 31)

Questions: accident time, state, loading/boarding-only, fatality, injury treated away, disabling-damage tow, citation (yes/no/not yet known), hazmat carried/released, 171.15 triggers.

Derived: `dotAccident` (390.5 definition), `qualifyingNonFatal`. Items: immediate response (best practice), recordable determination, post-accident alcohol (2 h / 8 h) and drug (32 h) tests with live due times, no alcohol for 8 h, NRC notice (12 h), Form F 5800.1 (30 days), accident register (3 yrs), record preservation, state crash report (state pack), insurer notice, vehicle return, internal review, or "not recordable" note. A pending citation leaves testing *Unable to determine* with a warning about the 8 h / 32 h windows.

### Positive test, refusal or other violation (scenarios 19, 20, 25)

Questions: what happened (positive, adulterated/substituted, alcohol ≥0.04, 0.02–0.039, refusal, actual knowledge), when you learned it, whether the driver will return. Items: immediate removal (382.501), refusal determination (40.191, non-delegable), employer Clearinghouse report by close of 3rd business day (382.705(b)) or confirm MRO report (382.705(a)), SAP list (40.287), employment decision (company policy, 40.305(b)), and — only if returning — SAP report + RTD test (40.305), report RTD negative, CDL reinstatement check (382.503(b)), follow-up testing ≥6 in 12 months (40.307). 0.02–0.039 produces only the 24-hour stand-down (382.505).

## 8. Security model

- **Tenant isolation:** `TenantRepository` adds `orgId` to every where/create and updates through `updateMany({id, orgId})`; cross-tenant ids return 404. Tests prove reads, lists and updates can't cross tenants and callers can't override `orgId`. Production hardening: Postgres row-level security keyed on a per-request `app.org_id` setting as a second layer.
- **Authentication:** scrypt password hashes (N=16384, r=8), 12-char minimum, login throttling (in-process in dev → shared store in prod), session tokens stored as SHA-256 hashes with 12 h expiry, httpOnly SameSite=Lax cookies (Secure in prod), TOTP MFA with token rotation after the second factor.
- **Authorization:** server-side permission checks on every action and route; role matrix in `rbac.ts`. Drug & alcohol and investigation-history documents require `document:read_sensitive` (391.53(a), 382.401(a) access limits). The person who submits an item cannot verify it.
- **Data minimization:** driver profiles store only the last 4 of the license number; SSN/DOB live only in uploaded source documents.
- **Documents:** encrypted at rest (dev: AES-256-GCM per file; prod: SSE-KMS), SHA-256 recorded, path-traversal-safe keys, `Content-Disposition: attachment`, `no-store`, every download and denied attempt audited. CSV export neutralizes formula injection.
- **Headers:** HSTS, nosniff, frame-deny, referrer policy, permissions policy.
- **Planned:** column encryption for `mfaSecret`, secrets via a managed vault, daily encrypted DB backups with PITR and quarterly restore tests, retention/deletion jobs driven by `retainUntil`, WAF and rate limiting at the edge.

## 9. Regulatory maintenance process

1. Change detected (Phase 3 monitor, or a person) → `RegulatoryChange` row, status QUEUED.
2. A compliance reviewer reads the official source, drafts the new rule version (bumped `version`, change-log entry, `lastVerified`), and records the review note.
3. Approval publishes the new `RuleVersion`; the catalog version increments. AI-drafted interpretations are never published without this step.
4. New runs use the new version. Existing runs keep their snapshot; affected open runs are flagged for review.

## 10. What is and isn't built

Built and covered by automated tests: rules engine, three rule catalogs, checklist generation, status machine, approval gate, readiness score, tenant repository, password/TOTP/token/storage-encryption primitives.

Built but not executed in the authoring environment (no package registry access there): the Next.js screens, server actions, route handlers, Prisma schema and seed. They were type-checked against simplified stand-in type declarations, which catches syntax and local-type errors but not every framework-API mismatch. Run `npm install`, `npx prisma migrate dev`, `npm run typecheck` and `npm run dev` to validate them for real.

Not built (shown as "Planned" in the UI): vehicles, compliance calendar, reminders, AI assistant, regulatory change monitor, state packs, server-side PDF, fleet-wide reports, S3 adapter.
