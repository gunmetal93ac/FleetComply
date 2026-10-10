# Regulatory Intelligence — design record and stage checklist

Monitors official regulatory sources, detects changes, maps them to the workflow steps and scenarios that depend on them, and prepares recommendations for an administrator. **It never modifies published compliance content without an administrator's explicit approval.**

**Status (2026-10-10): Stages 1 and 2 complete. Monitoring is manual — nothing is scheduled.** Official sources are checked only when an administrator runs a check. The first live check ran on 2026-10-10 (see "First live run" below).

## Decisions made by the owner

| Decision | Choice | Date |
|---|---|---|
| How approved changes are published | **Model A** — approved revisions are stored in the database and layered over the code catalog; the app serves the newest approved version; publish and rollback happen from the dashboard. Built in Stage 4 (the guide must then load rules from the server instead of bundling them). | 2026-10-10 |
| Who is the administrator | `owner@sample.fleetcomply.test` (platform administrator). Two-step verification is off on that account — turn it on before Stage 4. | 2026-10-10 |
| Existing "verified" labels | The 208 developer-checked steps keep their "last checked" wording and claim no human review. The 38 flagged steps now read "Regulatory guidance pending review" (superseding the 2026-10-10 "no wording changes" decision). `RuleReview` is now the review history. | 2026-10-11 |
| Approval and publication of corrections | Two separate administrator actions; see "Regulatory Verification" below. A small overlay of published step versions was built instead of the full Model A loader. | 2026-10-11 |

## How the pieces fit

```
official source ──(Stage 2 monitor)──▶ ProvisionVersion / RegulatoryChange
                                              │
RegulatoryProvision ◀── RuleProvisionRef ──▶ rule (workflow step, in the code catalog)
                                              │  rule.workflows
                                              ▼
                                        workflow ──▶ scenarios   (computed, not stored)
```

- **Compliance content lives in code**: `src/lib/rules/catalog/*.ts` (steps), `src/lib/workflows/definitions.ts` (questions and branching), `src/lib/workflows/scenarios.ts`. `RuleVersion` mirrors published rule versions in the database.
- **Dependencies are deterministic.** `src/lib/regulatory/citations.ts` reads the CFR section from each citation's official eCFR link and the paragraph designators from its text. `src/lib/regulatory/dependencies.ts` builds provision ⇄ step ⇄ scenario lookups. No AI is involved in matching.
- A dependency means "review this step if the provision changes" — not that the step is wrong.

## Access control

- Customer roles (Owner, Admin, …) apply inside one company and **never** grant access here — anyone who registers is Owner of their own company.
- `User.platformAdmin` is the gate. It is set only from the command line:

  ```
  npm.cmd run admin:grant -- someone@example.com
  npm.cmd run admin:grant -- someone@example.com --revoke
  npm.cmd run admin:grant -- --list
  ```

- `requirePlatformAdmin()` (`src/lib/auth/session.ts`) enforces it on the server: signed-out → login; signed-in non-administrator → 404. The navigation link is hidden for everyone else, but hiding is not relied on.
- Grants and revocations are written to `AuditLog`.

## Commands

| Command | What it does |
|---|---|
| `npm.cmd run reg:sync` | Rebuilds sources, provisions, step→provision references and missing rule versions from the catalog. Inserts and refreshes only; never deletes. Run after every catalog change. |
| `npm.cmd run reg:sync -- --dry-run` | Shows the plan without writing. |
| `npm.cmd run reg:check` | Runs a monitoring check now (both sources). `-- --source ecfr` or `-- --source fr` for one; `-- --dry-run` contacts the sources but writes nothing. Exit code 0 = succeeded, 3 = partial or already running, 2 = failed. |
| `npm.cmd run admin:grant -- <email>` | Grants platform administrator. |

Dashboard: `/admin/regulatory` (platform administrators only). It has a "Run check now" button (server-side authorization, audited, at most one manual run every two minutes).

## Database (migration `20261010120000_regulatory_intelligence_foundation`, additive)

| Table | Purpose | Filled by |
|---|---|---|
| `User.platformAdmin` | Administrator gate | grant script |
| `RegulatorySource` | eCFR, Federal Register (enabled); FMCSA, DOT (disabled until a structured feed is chosen) | sync |
| `RegulatoryProvision` | One row per CFR section; unique on title + section | sync |
| `ProvisionVersion` | Stored text + hash per fetched version; unique on provision + hash | Stage 2 |
| `RuleProvisionRef` | Step → provision, with paragraphs; unique on rule + provision | sync |
| `MonitorRun` | Log of every check, including failures and retries | Stage 2 |
| `RuleReview` | Documented human reviews | Stage 4 |
| `RegulatoryChange` (extended) | Detected changes: agency, action type, legal status, publication/effective/compliance dates, version references; unique on source + external id to prevent duplicate alerts | Stage 2 |

Applying migrations on this machine: generate the SQL with `prisma migrate diff`, review it, then `npx prisma migrate deploy` (never resets). Stop the dev server before `npx prisma generate` — Windows locks the query engine file while it runs.

## Citation audit (catalog 2026.10.2)

- 154 steps · 228 source citations · 213 link to an eCFR section · **67 distinct Title 49 sections** · 212 step→provision references.
- Parts cited: 40, 171, 172, 380, 382, 383, 390, 391, 392, 393, 395, 396.
- 14 steps cannot be monitored by regulation text (State law, agency web pages, best-practice items).
- 0 citations whose text and link disagree (enforced by a test).
- Paragraph-level matching is best-effort: 173 of 213 citations name a paragraph.

## Stage checklist

- [x] **Stage 1 — Foundation.** Citation audit, dependency map, database models, sync, platform-administrator gate, read-only dashboard, tests.
- [x] **Stage 2 — Monitoring (manual).** Done 2026-10-10 — see "Stage 2 as built" below. Original scope: Fetch eCFR section text and Federal Register documents through their official APIs; store versions; detect text changes and new documents; write `RegulatoryChange` rows without duplicates; log every run in `MonitorRun`; a failed check is recorded and retried with backoff and is never read as "no change". Manual trigger first (`npm.cmd run reg:check`).
  - eCFR versioner API confirmed reachable from this machine (`/api/versioner/v1/titles.json`, `/full/<date>/title-49.xml?part=&section=`); it returns HTTP 429 above roughly five parallel requests and HTTP 400 for unknown query parameters.
  - Federal Register API not yet exercised — confirm endpoints and agency filters first.
  - Treat fetched text as untrusted input.
- [ ] **Stage 3 — Impact analysis.** Deterministic citation match first; then AI assessment (new tables: assessments, proposed revisions). Requires `ANTHROPIC_API_KEY` in `.env` (document in `.env.example`; never commit a key). AI output is a recommendation, never published, never described as legally verified; source text must not be able to instruct the model.
- [ ] **Stage 4 — Review and publishing (Model A).** Review queue and comparison view; approve / edit / reject / investigate / dismiss; approved revision saved as a new `RuleVersion`; guide loads published rules from the server; rollback; `RuleReview` records; review notice on affected scenarios; every action audited.
- [ ] **Stage 5 — Automation.** Scheduled runs outside the Next.js dev server (a worker or managed cron calling a protected endpoint), overlap lock, notifications (new table), production readiness.

## Stage 2 as built

**Hard limits of the monitor**

- It can read the two official APIs, store section text, write the run log and add rows to the detected-change queue (always with status `DETECTED`). It has no code path to rules, rule versions, workflows or scenarios — a test enforces this.
- Only `www.ecfr.gov` and `www.federalregister.gov` can be contacted (allowlist in `src/lib/regulatory/http.ts`); any other host is refused before a request is made, including pagination links.
- Requests are made one at a time, 500 ms apart, 30 s timeout, up to 4 attempts with exponential backoff, honouring `Retry-After`.
- A section or query that fails is logged and reported as **not checked**. Its "last checked" time is left alone. A run with any failure is `PARTIAL` or `FAILED` and does not count as a successful source check.
- Overlap is prevented by an atomic lock on the source row (`RegulatorySource.lockedUntil`, expires after 20 minutes if a run dies).
- Duplicate alerts are prevented by the unique key (source, external id): the Federal Register document number, or `49:<section>@<amendment date>` for eCFR text changes.
- Fetched text is stored and shown as plain data. Nothing in it is executed or followed.

**eCFR check** (`src/lib/regulatory/ecfr.ts`, `monitor.ts`)

1. Get Title 49's latest issue date.
2. For each cited part, get the amendment history of every section (one request per part).
3. Per monitored section: nothing stored → store the text as a **baseline, no alert**; same amendment date → unchanged, no download; newer amendment → download and compare hashes → identical text means no alert, different text creates a `TEXT_CHANGE` item linking the previous and new stored versions; marked removed → `REMOVED` item; absent from the history → reported as a failure, never as a removal.

**Federal Register check** (`src/lib/regulatory/federal-register.ts`)

Two queries: everything FMCSA published since the catalog's eCFR issue date (`CATALOG_CHECKED_AGAINST_ECFR_ISSUE` in `src/lib/rules/catalog/util.ts`), and all Title 49 rules and proposed rules for the past 12 months.

Classification is by fixed rules over source fields only (document type, action line, effective date, CFR references, agency, title, docket) — no AI, no reading of the document body:

| Stored | Not stored (identifier, reason and counts go in the run log) |
|---|---|
| FMCSA rules and proposed rules (low priority if no current scenario cites the part) | Other agencies' rules that reference no monitored part |
| Any agency's rule or proposal that references a monitored part | Rules already in effect before the catalog was checked |
| Corrections, delays, stays, withdrawals, interim final rules | Information-collection notices |
| Notices that reference a monitored part | Individual driver medical exemptions |
| Exemption grants, renewals, modifications and revocations concerning a monitored part | Exemption applications, requests for comment and denials |

Legal status: a proposal is always `PROPOSED`, whatever else the data says. A rule is `EFFECTIVE` or `FINAL_NOT_YET_EFFECTIVE` from its effective date, `UNKNOWN` if the data has none. A document in the Rules section whose action line does not say "rule" or "amendment" is labelled a notice with status `UNKNOWN`. A proposal with a later final rule in the same docket is kept, flagged and lowered to low priority.

**Known limits**

- Federal Register references stop at the **part**. A rule or proposal is matched to every step citing that part — broad on purpose. Section precision comes from the eCFR text once a change is in effect.
- For exemption notices with no CFR reference, the part is inferred from FMCSA's standard title prefix and marked as inferred.
- "Proposed Rule" covers NPRMs, advance notices, petitions and comment-period extensions alike; the action line is shown so a reader can tell.
- FMCSA and DOT websites are not monitored. Guidance, interpretations and enforcement policy published only there are **not** covered. The two website sources exist in `RegulatorySource` (disabled) so they can be added later.
- The baseline is the text at eCFR issue 2026-10-05, the same issue the catalog was written against. Anything wrong in the catalog before that date is not something monitoring can detect.
- Items stored by the first live run keep the labels given at that time; two classifier refinements made afterwards (notifications in the Rules section; docket linking) apply to new items only.

## First live run — 2026-10-10

Manual, authorised by the owner. 84 requests, 0 retries, 0 failures, about 3 minutes.

- **eCFR:** succeeded. 67 of 67 sections checked; baseline text stored for all (about 375,000 characters); 0 alerts, as intended for a baseline. Fourteen of the 67 sections were last amended during 2026.
- **Federal Register:** succeeded. 215 publications examined; 17 stored, 198 skipped (163 other agency with no monitored part, 33 already in effect before the catalog was checked, 2 information-collection notices).

Stored items worth an administrator's attention first:

| Document | What it is | Status | Parts | Note |
|---|---|---|---|---|
| 2026-19741 | PHMSA final rule, ASME Code / inspection code | Final, effective 2026-10-28 | 171 (also 107, 173, 178–180) | Part-level match only; likely tank and packaging standards rather than the incident-reporting sections the catalog cites — needs a read. |
| 2026-15809 | PHMSA final rule, CERCLA hazardous substances list | Final, effective 2026-12-02 | 171, 172 | Part-level match only. |
| 2026-20325 | FMCSA final rule, emergency exemptions | In effect 2026-10-05 | 390 | Published the same day as the eCFR issue the catalog was checked against. |
| 2026-16288 | FMCSA proposed rule, English language proficiency / out-of-service criteria | Proposed | 390, 391 | Not binding. Touches driver qualification if finalised. |
| 2026-20169 | DOT petition for rulemaking, invalid specimen determinations | Proposed (petition notice) | 40 | Not binding. |
| 2026-04337 | DOT notification, SAP do's and don'ts | Status unknown | 40 | Guidance-type document published with the rules; stored as "final rule / unknown" by the first run. |

The other eleven are proposals on parts no current scenario cites (UCR fees, CDLIS fees, hazmat permits), hazardous-materials advance notices, two exemption notices, and proposals already finalised.

## Regulatory Verification (built 2026-10-11, exemption step first)

Resolves "pending review" steps. Owner decisions (2026-10-11): approval records "Approved — awaiting publication" and changes nothing for customers; **Publish Correction** is a separate administrator action that creates a new version of the step; read-only live requests to eCFR and the Federal Register are authorised for source checks; FMCSA's website is link-only; all 38 flagged steps are in the queue.

**Where things are**

| Piece | Location |
|---|---|
| Queue | `/admin/regulatory#verification` |
| Review screen | `/admin/regulatory/verification/<ruleId>` |
| Logic (framework-free, tested) | `src/lib/regulatory/verification.ts` |
| Database store, eCFR access, served overrides | `src/lib/regulatory/verification-store.ts` |
| Server actions (authorised by `platformAdmin` on the server) | `src/app/actions/verification.ts` |
| Customer labels and the content / applicability split | `src/lib/rules/content-review.ts` |
| Command line (list, load a draft, source check — cannot approve or publish) | `npm.cmd run reg:verify -- --list` · `-- <ruleId> --check` · `-- <ruleId> --draft <file>` |
| Prepared drafts | `docs/verification-drafts/` |

**Statuses:** Not yet reviewed · Review required · Source checked, awaiting review · Correction requested · Approved — awaiting publication · Reviewed and published · Reverification required. Before any administrator acts, a step is "Review required" if it is safety-sensitive or a deterministic check flags its citation, otherwise "Not yet reviewed".

**Rules the code enforces (each has a test)**

- A source check retrieves text and runs fixed checks. It records evidence, may move a step to "Source checked", and never approves, edits or publishes. An incomplete retrieval leaves the step where it was.
- Approval needs: every CFR section the approved wording cites retrieved by a source check; at least one official (.gov, https) source; a written note; the typed word `APPROVE`.
- Publication needs an approval record and the typed word `PUBLISH`. What is published is exactly the wording in the approval record. Editing the draft after approval withdraws the approval.
- A correction can change wording and citations only — not when a step applies, its deadline logic or its restriction.
- Published corrections are stored as `RuleVersion` rows with `origin = CORRECTION` and layered over the code catalog (`publishedOverrides`). The catalog's version is kept; saved checklists keep their own snapshot. If the catalog later reaches the same or a higher version of that step, the catalog is served.
- "Reject incorrect guidance" puts a notice on the step for customers until a correction is published. No other review action changes what customers see.
- A detected change (section text change, or a rule in effect or final for a cited part) dated after publication moves the step to "Reverification required". The published content is not altered.
- Content review and customer applicability are separate: `contentReview(rule)` and `applicabilityStatus(rule, classification)`. Approving content never resolves eligibility; an exemption step always shows eligibility as not established.

**Database (migration `20261011090000_regulatory_verification`, additive):** new table `RuleVerification` (current state per step); new nullable columns on `RuleReview` (claim, previous and updated wording, evidence, regulatory version); `RuleVersion.origin`, `reviewId`, `publishedById`.

**Deterministic checks and their limits.** Format, link/text disagreement, a range or subpart covered by one link, section missing / removed / reserved, amended after the catalog's eCFR issue, a detected change on the section or part — these are established by the check. "Exemption scope" and "unrelated topic" are raised as *possible* from which parts are cited; they cannot establish that a statement of law is right or wrong.

**State of the exemption step (`REVIEW-CLAIMED-EXEMPTION`) on 2026-10-11:** draft correction loaded (attributed "prepared draft", not a reviewer); live source check complete — 13 requests, eCFR issue 2026-10-05, §§ 383.3, 391.2, 391.61–391.63, 391.65, 391.67–391.69 retrieved, § 391.64 reserved; status "Source checked, awaiting review". **No decision has been recorded.** The approval and publication steps were exercised in automated tests only, never against the real database.

### Findings, coverage and change relevance (added 2026-10-11)

Logic in `src/lib/regulatory/findings.ts`; migration `20261011150000_verification_findings_coverage` (additive: `RuleProvisionRef.origin`, `RuleVerification.findingReviews`).

- **Every finding** has a stable key, a one-line message, why it matters, the official sources involved, a recommended next action, and whether it concerns the current wording, the proposed correction or both. An administrator marks it *resolved*, *not applicable* (reason required) or *requiring further review*; each entry is appended to the finding's history and the audit log. Handling a finding approves nothing.
- **Approval waits for findings.** Content cannot be approved while a non-informational finding about that content is open or marked "requires further review". A finding about the current wording only does not block a correction that removes it. A directly cited reserved, removed or missing section blocks approval whatever the findings say.
- **Citation coverage.** A source check expands a range or subpart citation into its sections using the eCFR's own list (including the `subpart` field), each with status — active, reserved, removed — and official link. Active sections of a range or subpart are offered for monitoring; sections of a part-level citation are listed but never pre-selected or retrieved. "Monitor selected sections" adds `RuleProvisionRef` rows with `origin = COVERAGE`; `reg:sync` leaves them alone and does not report them as stale. A newly monitored section gets its baseline at the next monitoring check.
- **Citation repair** ("Draft citation repair") rewrites range and subpart citations as individual active sections and points a mismatched link at the named section when that section was found active. It writes a draft only.
- **Exemption scope.** For a step about an exemption, the check asks whether it cites the section where each regime the workflow uses sets out its own exceptions: § 383.3 (CDL), § 382.103 (testing), § 391.2 / Subpart G (driver qualification). One finding per regime not cited. It is a prompt, not a ruling.
- **Change relevance.** A detected item is *confirmed* only when the stored text of a cited section changed; *likely* when the source's own title, summary or citation line names a cited section; *possible* when only the part number is shared; *probably not relevant* when it names other sections. Only confirmed items, and likely items that are final or in effect, trigger "Reverification required". Federal Register references stop at the part, and only titles and summaries are scanned for section numbers — a document that amends a cited section without naming it in those fields shows as "possible" until the eCFR text changes.

**What the sources say about Parts 391, 383 and 382** (read 2026-10-11 at eCFR issue 2026-10-05; §§ 383.3, 382.103, 391.2, 391.61 and 391.63 compared with stored text, the rest from a paragraph-level extraction):

- Part 391 sets driver-qualification rules (§ 391.1) and does not mention CDLs. Its exceptions are § 391.2 and Subpart G; they relieve listed Part 391 requirements only.
- § 383.3 sets out who is excepted from the CDL rules, and § 383.3(b) says the general § 390.3(f) exceptions do not apply to Part 383.
- Part 382 applies to drivers subject to the Part 383 CDL requirements (§ 382.103(a)); the § 390.3T(f) exceptions do not apply (§ 382.103(c)); its exceptions are listed in § 382.103(d) and track certain CDL exceptions. It does not mention Part 391.

Open questions for the human reviewer: § 390.3T(f) and Part 381 were not read; FMCSA guidance was not read; § 383.3(d)(3) (snow and ice removal) has no counterpart in the § 382.103(d) list as extracted; State adoption of discretionary CDL waivers is unknown to the system; how Part 391 exemptions carry into intrastate operations depends on State adoption.

### Turning on two-step verification for the administrator account

The app supports it (authenticator-app codes). It is still off on `owner@sample.fleetcomply.test`, the account that approves regulatory content.

1. Sign in as the administrator and open **Settings**.
2. Under **Your security**, press **Turn on two-step verification**.
3. Add the key shown to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and similar) by manual entry.
4. Enter the 6-digit code the app shows and press **Confirm**. The page then reads "Two-step verification is on for your account".
5. From the next sign-in the app asks for a code after the password. Keep the authenticator device safe — there are no recovery codes yet.

## Tests

`tests/regulatory.verification.test.ts` — all regulatory text and change records are simulated (marked `SIM`). Covers: the queue and its priority; the exemption step's scope and link findings; the prepared correction; the full draft → source check → approval → publication flow with nothing changing for customers before publication; a valid citation; missing, removed and reserved sections, wrong links, bad format and unofficial sources; an unrelated-topic citation; an amended section and linked detected changes; an unreachable source; exemption eligibility and customer applicability staying unresolved; renewed review after a regulatory change; the other three decisions; administrator-only enforcement on every action; and that with nothing published the checklists are exactly the catalog's.

`tests/regulatory.monitor.test.ts` — all fixtures are simulated and labelled as such (document numbers begin `SIM-`). Covers: host allowlist; retry, backoff and Retry-After; baseline without alerts; change detected once with versions linked; no duplicates on re-run; identical text under a new amendment date; failed sections logged, left unchecked and retried on the next run; source outage; removal versus missing; run lock; proposals never effective; future-effective rules and urgency; corrections, delays, stays, withdrawals, interim final rules; the relevance filter and skip reasons; skipped identifiers and counts in the run log; truncated results reported as partial; pagination links to other hosts not followed; mapping of changes to steps and scenarios; and the safeguard that the monitor cannot reach compliance content.

`tests/regulatory.foundation.test.ts` — citation parsing, dependency map invariants over the real catalog, sync idempotency (second run is a no-op; nothing is deleted), platform-administrator gate, navigation visibility, and a check that existing workflows still generate.
