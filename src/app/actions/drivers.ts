"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/auth/session";
import { JURISDICTIONS } from "@/lib/rules/state-registry";

export type DriverFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;
const STATES = new Set(JURISDICTIONS.map(([c]) => c));
const ENDORSEMENTS = new Set(["H", "N", "P", "S", "T", "X"]);

function parse(form: FormData) {
  const v = (k: string) => String(form.get(k) ?? "").trim();
  const fe: Record<string, string> = {};
  const date = (k: string) => {
    const s = v(k);
    if (!s) return null;
    const d = new Date(`${s}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) fe[k] = "Invalid date";
    return d;
  };
  const data = {
    firstName: v("firstName"),
    lastName: v("lastName"),
    email: v("email") || null,
    phone: v("phone") || null,
    status: v("status") || "APPLICANT",
    cdlState: v("cdlState") || null,
    cdlClass: v("cdlClass") || null,
    cdlNumberLast4: v("cdlNumberLast4") || null,
    endorsements: form.getAll("endorsements").map(String).filter((e) => ENDORSEMENTS.has(e)),
    cdlExpiresOn: date("cdlExpiresOn"),
    medCertExpiresOn: date("medCertExpiresOn"),
    hireDate: date("hireDate"),
  };
  if (!data.firstName) fe.firstName = "Required";
  if (!data.lastName) fe.lastName = "Required";
  if (data.cdlState && !STATES.has(data.cdlState)) fe.cdlState = "Choose a state";
  if (data.cdlClass && !["A", "B", "C"].includes(data.cdlClass)) fe.cdlClass = "A, B or C";
  if (data.cdlNumberLast4 && !/^[A-Za-z0-9]{1,4}$/.test(data.cdlNumberLast4)) fe.cdlNumberLast4 = "Last 4 characters only";
  if (!["APPLICANT", "ACTIVE", "INACTIVE", "TERMINATED"].includes(data.status)) fe.status = "Invalid status";
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) fe.email = "Invalid email";
  return { data, fe };
}

export async function createDriverAction(_: DriverFormState, form: FormData): Promise<DriverFormState> {
  const { user, r } = await requireTenant("driver:write");
  const { data, fe } = parse(form);
  if (Object.keys(fe).length) return { fieldErrors: fe };
  const d = await r.create("driver", data);
  await r.create("auditLog", { actorId: user.id, action: "driver.create", entityType: "Driver", entityId: d.id });
  redirect(`/drivers/${d.id}`);
}

export async function updateDriverAction(id: string, _: DriverFormState, form: FormData): Promise<DriverFormState> {
  const { user, r } = await requireTenant("driver:write");
  const { data, fe } = parse(form);
  if (Object.keys(fe).length) return { fieldErrors: fe };
  try {
    await r.update("driver", id, data);
  } catch {
    return { error: "Driver not found." };
  }
  await r.create("auditLog", { actorId: user.id, action: "driver.update", entityType: "Driver", entityId: id, meta: { fields: Object.keys(data) } });
  revalidatePath(`/drivers/${id}`);
  return { error: undefined };
}
