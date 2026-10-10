/**
 * Seed script — syncs the reviewed rule catalog into RuleVersion and creates a
 * clearly labeled SAMPLE company with fictional drivers for demonstration.
 *
 *   npm run db:seed
 *
 * Demo logins (local development only):
 *   owner@sample.fleetcomply.test / safety@sample.fleetcomply.test / hr@sample.fleetcomply.test
 *   password: $SEED_DEMO_PASSWORD or "sample-demo-password"
 */
import { PrismaClient } from "@prisma/client";
import { ALL_RULES, CATALOG_VERSION, validateCatalog } from "../src/lib/rules/catalog";
import { generateChecklist } from "../src/lib/workflows/checklist";
import { WORKFLOWS, type Answers } from "../src/lib/workflows/definitions";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();
const DAY = 86_400_000;

async function syncCatalog() {
  const problems = validateCatalog();
  if (problems.length) throw new Error(`Rule catalog failed validation:\n${problems.join("\n")}`);
  for (const r of ALL_RULES) {
    await prisma.ruleVersion.upsert({
      where: { ruleId_version: { ruleId: r.id, version: r.version } },
      // Published versions are immutable: never update an existing row.
      update: {},
      create: {
        ruleId: r.id,
        version: r.version,
        snapshot: r as unknown as object,
        verificationStatus: r.verificationStatus,
        lastVerified: r.lastVerified,
        catalogVersion: CATALOG_VERSION,
      },
    });
  }
  console.log(`Rule catalog ${CATALOG_VERSION}: ${ALL_RULES.length} rules synced.`);
}

async function createSampleCompany() {
  const existing = await prisma.organization.findFirst({ where: { isSample: true } });
  if (existing) {
    console.log("Sample company already exists — skipping.");
    return;
  }
  const password = process.env.SEED_DEMO_PASSWORD ?? "sample-demo-password";
  const passwordHash = await hashPassword(password);

  const org = await prisma.organization.create({
    data: { name: "SAMPLE — Red Mesa Demo Freight (fictional)", usdotNumber: null, baseState: "TX", preEmploymentAlcoholTesting: false, isSample: true },
  });
  const [owner, safety] = await Promise.all([
    prisma.user.create({ data: { orgId: org.id, email: "owner@sample.fleetcomply.test", name: "Sample Owner", role: "OWNER", passwordHash } }),
    prisma.user.create({ data: { orgId: org.id, email: "safety@sample.fleetcomply.test", name: "Sample Safety Manager", role: "SAFETY_MANAGER", passwordHash } }),
    prisma.user.create({ data: { orgId: org.id, email: "hr@sample.fleetcomply.test", name: "Sample HR Coordinator", role: "HR", passwordHash } }),
  ]);

  const now = Date.now();
  const mk = (firstName: string, lastName: string, extra: object) =>
    prisma.driver.create({ data: { orgId: org.id, firstName, lastName, isSample: true, ...extra } });
  const active = await mk("Sample Driver", "Alvarez (fictional)", {
    status: "ACTIVE", cdlState: "TX", cdlClass: "A", endorsements: ["N"], cdlNumberLast4: "0000",
    cdlExpiresOn: new Date(now + 400 * DAY), medCertExpiresOn: new Date(now + 21 * DAY), hireDate: new Date(now - 500 * DAY),
  });
  await mk("Sample Driver", "Brooks (fictional)", {
    status: "ACTIVE", cdlState: "OK", cdlClass: "B", cdlNumberLast4: "0001",
    cdlExpiresOn: new Date(now + 45 * DAY), medCertExpiresOn: new Date(now + 300 * DAY), hireDate: new Date(now - 200 * DAY),
  });
  const applicant = await mk("Sample Applicant", "Chen (fictional)", { status: "APPLICANT", cdlState: "NM", cdlClass: "A", endorsements: ["H"] });

  async function seedRun(key: keyof typeof WORKFLOWS, answers: Answers, driverId: string, title: string) {
    const c = generateChecklist(WORKFLOWS[key], answers, { baseState: "TX", preEmploymentAlcoholTesting: false });
    const run = await prisma.workflowRun.create({
      data: {
        orgId: org.id, workflowKey: key, title, driverId, answers: answers as object, facts: c.facts as object,
        warnings: c.warnings, catalogVersion: c.catalogVersion, createdById: owner.id,
      },
    });
    for (const it of c.items) {
      await prisma.checklistItem.create({
        data: {
          orgId: org.id, runId: run.id, ruleId: it.ruleId, ruleVersion: it.ruleVersion, ruleSnapshot: it.ruleSnapshot as unknown as object,
          stage: it.stage, title: it.title, classification: it.classification, reasons: it.reasons,
          blocksSafetySensitive: it.blocksSafetySensitive, status: it.status, sortOrder: it.sortOrder, dueAt: it.dueAt,
        },
      });
    }
    return run;
  }

  const start = new Date(now + 10 * DAY).toISOString().slice(0, 10);
  const hire = await seedRun(
    "HIRE_CDL_DRIVER",
    {
      companyState: "TX", licenseState: "NM", operatingState: "TX", operationType: "INTERSTATE", cdlVehicle: true, cdlClass: "A",
      hazmat: true, passengers: false, tankOrDoublesAssignment: "NO", dotTesting: "YES", experience: "EXPERIENCED",
      priorDotEmployment: "YES", nonFmcsaDotEmployer: "NO", priorViolation: "NO", preEmploymentTestException: "NO",
      exemption: "NONE", employmentStartDate: start,
    },
    applicant.id,
    "Hire a new CDL driver — Sample Applicant Chen (fictional)",
  );
  // Show a realistic mid-process state: application submitted, awaiting verification by the safety manager.
  const app = await prisma.checklistItem.findFirst({ where: { runId: hire.id, ruleId: "FED-391.21-EMPLOYMENT-APPLICATION" } });
  if (app) {
    await prisma.checklistItem.update({ where: { id: app.id }, data: { status: "PENDING_VERIFICATION", completedById: owner.id, completionDate: new Date(now).toISOString().slice(0, 10), notes: "SAMPLE: signed application received (fictional — no real document attached)." } });
    await prisma.itemEvent.createMany({
      data: [
        { orgId: org.id, itemId: app.id, actorId: owner.id, kind: "STATUS", fromStatus: "NOT_STARTED", toStatus: "IN_PROGRESS" },
        { orgId: org.id, itemId: app.id, actorId: owner.id, kind: "STATUS", fromStatus: "IN_PROGRESS", toStatus: "PENDING_VERIFICATION", note: "Sample data" },
      ],
    });
  }

  await seedRun(
    "DOT_ACCIDENT_RESPONSE",
    {
      accidentAt: new Date(now - 3 * 3_600_000).toISOString(), accidentState: "TX", onlyBoardingOrCargo: false,
      fatality: false, injuryTreatedAway: false, towAway: true, driverCited: "PENDING", hazmatInvolved: false,
    },
    active.id,
    "Accident response — Sample Driver Alvarez (fictional)",
  );

  console.log(`Sample company created. Sign in as owner@sample.fleetcomply.test or ${safety.email} with password "${password}" (local development only).`);
}

syncCatalog()
  .then(createSampleCompany)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
