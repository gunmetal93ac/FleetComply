"use client";

import { useActionState } from "react";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { JURISDICTIONS } from "@/lib/rules/state-registry";
import type { DriverFormState } from "@/app/actions/drivers";

export interface DriverValues {
  firstName?: string; lastName?: string; email?: string | null; phone?: string | null; status?: string;
  cdlState?: string | null; cdlClass?: string | null; cdlNumberLast4?: string | null; endorsements?: string[];
  cdlExpiresOn?: string | null; medCertExpiresOn?: string | null; hireDate?: string | null;
}

const END = [["H", "Hazmat"], ["N", "Tank"], ["P", "Passenger"], ["S", "School bus"], ["T", "Doubles/triples"], ["X", "Tank + hazmat"]];

export function DriverForm({ action, initial = {}, submitLabel }: { action: (s: DriverFormState, f: FormData) => Promise<DriverFormState>; initial?: DriverValues; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};
  const err = (k: string) => (fe[k] ? <p className="mt-1 text-xs text-red-600">{fe[k]}</p> : null);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {state && !state.error && !state.fieldErrors && <Alert tone="green">Saved.</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="firstName">First name</Label><Input id="firstName" name="firstName" defaultValue={initial.firstName} />{err("firstName")}</div>
        <div><Label htmlFor="lastName">Last name</Label><Input id="lastName" name="lastName" defaultValue={initial.lastName} />{err("lastName")}</div>
        <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" defaultValue={initial.email ?? ""} />{err("email")}</div>
        <div><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" defaultValue={initial.phone ?? ""} /></div>
        <div>
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={initial.status ?? "APPLICANT"}>
            <option value="APPLICANT">Applicant</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="TERMINATED">Terminated</option>
          </Select>
        </div>
        <div><Label htmlFor="hireDate">Hire date</Label><Input id="hireDate" name="hireDate" type="date" defaultValue={initial.hireDate ?? ""} />{err("hireDate")}</div>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">License & medical</legend>
        <div>
          <Label htmlFor="cdlState">CDL state</Label>
          <Select id="cdlState" name="cdlState" defaultValue={initial.cdlState ?? ""}>
            <option value="">—</option>{JURISDICTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </Select>{err("cdlState")}
        </div>
        <div>
          <Label htmlFor="cdlClass">CDL class</Label>
          <Select id="cdlClass" name="cdlClass" defaultValue={initial.cdlClass ?? ""}><option value="">—</option><option>A</option><option>B</option><option>C</option></Select>{err("cdlClass")}
        </div>
        <div><Label htmlFor="cdlNumberLast4">License # (last 4 only)</Label><Input id="cdlNumberLast4" name="cdlNumberLast4" maxLength={4} defaultValue={initial.cdlNumberLast4 ?? ""} />{err("cdlNumberLast4")}</div>
        <div><Label htmlFor="cdlExpiresOn">CDL expires</Label><Input id="cdlExpiresOn" name="cdlExpiresOn" type="date" defaultValue={initial.cdlExpiresOn ?? ""} />{err("cdlExpiresOn")}</div>
        <div><Label htmlFor="medCertExpiresOn">Medical certification expires</Label><Input id="medCertExpiresOn" name="medCertExpiresOn" type="date" defaultValue={initial.medCertExpiresOn ?? ""} />{err("medCertExpiresOn")}</div>
        <div className="sm:col-span-3">
          <span className="mb-1 block text-sm font-medium">Endorsements</span>
          <div className="flex flex-wrap gap-3 text-sm">
            {END.map(([c, n]) => (
              <label key={c} className="flex items-center gap-1"><input type="checkbox" name="endorsements" value={c} defaultChecked={initial.endorsements?.includes(c)} /> {c} — {n}</label>
            ))}
          </div>
        </div>
      </fieldset>
      <p className="text-xs text-slate-500">Full license numbers, SSNs and dates of birth are not stored in driver profiles. Keep them only in the uploaded source documents, which are encrypted and access-logged.</p>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
