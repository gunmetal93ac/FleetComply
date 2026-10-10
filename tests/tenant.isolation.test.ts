import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryDb, NotFoundError, TenantRepository } from "../src/lib/tenant/repository";
import { can, SENSITIVE_CATEGORIES } from "../src/lib/auth/rbac";

async function setup() {
  const db = createMemoryDb();
  const a = new TenantRepository("org_A", db);
  const b = new TenantRepository("org_B", db);
  const driverA = await a.create("driver", { firstName: "Sample", lastName: "Driver A" });
  const itemA = await a.create("checklistItem", { title: "MVR", status: "NOT_STARTED" });
  const docA = await a.create("document", { filename: "mvr.pdf", recordCategory: "DRIVER_QUALIFICATION_FILE" });
  return { db, a, b, driverA, itemA, docA };
}

test("org B cannot read org A's driver, checklist item or document by id", async () => {
  const { b, driverA, itemA, docA } = await setup();
  await assert.rejects(b.find("driver", driverA.id), NotFoundError);
  await assert.rejects(b.find("checklistItem", itemA.id), NotFoundError);
  await assert.rejects(b.find("document", docA.id), NotFoundError);
});

test("org B listing never includes org A's rows", async () => {
  const { b } = await setup();
  assert.deepEqual(await b.list("driver"), []);
  assert.deepEqual(await b.list("document"), []);
});

test("org B cannot update org A's item, and the row is unchanged", async () => {
  const { a, b, itemA } = await setup();
  await assert.rejects(b.update("checklistItem", itemA.id, { status: "COMPLETED" }), NotFoundError);
  assert.equal((await a.find("checklistItem", itemA.id)).status, "NOT_STARTED");
});

test("callers cannot override orgId in a where-clause, create, or update", async () => {
  const { db, a, b, driverA } = await setup();
  assert.equal(await b.findMaybe("driver", { id: driverA.id, orgId: "org_A" }), null);
  const created = await b.create("driver", { firstName: "X", orgId: "org_A" });
  assert.equal(created.orgId, "org_B");
  await a.update("driver", driverA.id, { orgId: "org_B", lastName: "Changed" });
  const row = db._rows.driver.find((r: any) => r.id === driverA.id);
  assert.equal(row.orgId, "org_A");
  assert.equal(row.lastName, "Changed");
});

test("repository refuses to construct without an org id", () => {
  assert.throws(() => new TenantRepository("", createMemoryDb()));
});

test("sensitive record categories are restricted by role (391.53 / 382.401)", () => {
  assert.ok(SENSITIVE_CATEGORIES.has("DRUG_ALCOHOL_PROGRAM"));
  assert.ok(SENSITIVE_CATEGORIES.has("DRIVER_INVESTIGATION_HISTORY_FILE"));
  assert.equal(can("HR", "document:read_sensitive"), false);
  assert.equal(can("DISPATCH", "document:read"), false);
  assert.equal(can("SAFETY_MANAGER", "document:read_sensitive"), true);
});
