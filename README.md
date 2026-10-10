# FleetComply (Phase 1 MVP)

Action-based compliance workflows for U.S. motor carriers. Pick a situation — *hire a CDL driver*, *one of our drivers had an accident*, *a driver tested positive* — answer a few questions, and get a personalized checklist that says what must be done, why, by when, what evidence to keep, how long to keep it, and which regulation requires it.

> **Not legal advice.** FleetComply explains regulations and tracks evidence. Approving a workflow records a human review; it does not certify that a driver is qualified or that a company is compliant. Items marked **Requires Regulatory Verification** or **Unable to determine** need a qualified person's review.

Design documentation: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (architecture, schema, rules engine, feature map, roadmap, screen and workflow designs, security model).

## What works in this build

| Live | Planned (shown as such in the UI) |
|---|---|
| Company sign-up, login, sessions, TOTP two-step verification, 6 roles | Vehicles, compliance calendar, reminders (email/SMS) |
| "What are you trying to accomplish?" — 50 scenarios, 15 live via 3 workflows | AI assistant (retrieval over the approved catalog) |
| **Hire a new CDL driver** (federal DQ file, investigations, drug & alcohol, hazmat, HR kept separate) | State rule packs (all 51 registered, none loaded) |
| **Accident response** with live post-accident testing deadlines | Regulatory change monitor (schema only) |
| **Positive test / refusal / violation** with Clearinghouse reporting deadlines | Server-side PDF, fleet-wide reports, S3 storage |
| Checklist: statuses, two-person verification, N/A with reason, blocked, assign, deadlines, notes, evidence upload, history | |
| Final review & approval, printable report, CSV export | |
| Dashboard with explained readiness score and filters; drivers; documents; regulatory library | |

## Requirements

- Node.js 20.11+ (22 LTS recommended)
- PostgreSQL 14+
- npm

## Installation

```bash
git clone <your repo> fleetcomply && cd fleetcomply
npm install
cp .env.example .env
```

Edit `.env`:

```bash
# generate a storage key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste it into `STORAGE_ENCRYPTION_KEY`, and set `DATABASE_URL`.

## Database setup

Start PostgreSQL (Docker example):

```bash
docker run -d --name fleetcomply-db -p 5432:5432 \
  -e POSTGRES_USER=fleetcomply -e POSTGRES_PASSWORD=fleetcomply -e POSTGRES_DB=fleetcomply \
  postgres:16
```

Create the schema and load the rule catalog plus the **sample** company:

```bash
npx prisma migrate dev --name init   # creates tables and generates the Prisma client
npm run db:seed                      # syncs rule catalog; creates SAMPLE company + fictional drivers
```

Sample logins (local only — password `sample-demo-password`, or set `SEED_DEMO_PASSWORD` before seeding):

| Email | Role |
|---|---|
| owner@sample.fleetcomply.test | Owner |
| safety@sample.fleetcomply.test | Safety manager (can verify and approve) |
| hr@sample.fleetcomply.test | HR (can submit, cannot verify) |

Everything in the sample company is labeled **SAMPLE / fictional**. To start clean, go to `/register` and create your own company instead.

## Local development

```bash
npm run dev          # http://localhost:3000
npm test             # rules engine, checklists, status transitions, tenant isolation, security primitives
npm run typecheck    # TypeScript over the whole project
npm run catalog:check  # validates every rule entry; lists items flagged "Requires Regulatory Verification"
```

Try it:
1. Sign in as `owner@…`, click **Hire a new CDL driver** on the dashboard, answer the questions.
2. Open an item, read *Why this is on your checklist*, upload a file, **Submit for verification**.
3. Sign in as `safety@…` in another browser and **Verify & complete** it (the submitter can't verify their own item).
4. When every required item is resolved, write a review note and **Approve after review**; open **Compliance report**.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `STORAGE_ENCRYPTION_KEY` | yes (local storage) | 32 bytes, base64 |
| `STORAGE_DRIVER` | no | `local` (development adapter). Production S3 adapter not implemented yet. |
| `STORAGE_LOCAL_DIR` | no | default `./.data/uploads` |
| `MAX_UPLOAD_MB` | no | default 15 |
| `COOKIE_SECURE` | prod | `true` behind HTTPS |
| `SEED_DEMO_PASSWORD` | no | password for sample users |
| `ANTHROPIC_API_KEY` | Phase 3 | not used yet |

## Development adapters (not production integrations)

- **Storage:** `LocalEncryptedDiskAdapter` — AES-256-GCM files on local disk. Fine for development; production needs object storage with KMS encryption and backups.
- **Login throttling:** in-process memory; use a shared store (e.g. Redis) when running more than one server.
- **PDF:** the report page uses the browser's *Print → Save as PDF*.
- **FMCSA Clearinghouse, MVR vendors, CDLIS:** no integrations. The checklist tells you what to obtain; you upload the result.

## Project layout

```
prisma/              schema.prisma, seed.ts
src/lib/rules/       types, engine, state registry, catalog/ (federal hiring, accident, drug & alcohol)
src/lib/workflows/   definitions (questionnaires), checklist, status, review, scenarios
src/lib/tenant/      TenantRepository (org-scoped data access)
src/lib/auth/        password, totp, tokens, rbac, session
src/lib/storage/     encryption + storage adapters
src/app/             Next.js routes: (auth), (app), api/, actions/
src/components/      UI primitives, checklist, questionnaire, forms
tests/               node:test suites (run with tsx)
docs/ARCHITECTURE.md
```

## Adding or changing a rule

1. Edit or add an entry under `src/lib/rules/catalog/`. Never change a published entry in place: bump `version` and append to `changeLog`.
2. Cite the official source URL; set `lastVerified` only after reading the current official text. Otherwise use `verificationStatus: "REQUIRES_VERIFICATION"` with a `verificationNote`.
3. `npm run catalog:check && npm test`, then `npm run db:seed` to publish the new `RuleVersion`. Existing checklists keep the version they were created with.

## Build status of this delivery

The domain core (rules engine, catalogs, checklist generation, status machine, approval gate, tenant repository, auth and storage primitives) was executed in the authoring environment: **63 tests pass** and it type-checks under `strict`. The Next.js/Prisma application layer was written in full but could not be installed or run there (no package-registry access); it was type-checked only against simplified stand-in declarations. Expect to fix small framework-level type or runtime issues on first `npm run typecheck` / `npm run dev`.
