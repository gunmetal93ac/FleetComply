"use client";

import { useActionState } from "react";
import { registerAction } from "@/app/actions/auth";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { JURISDICTIONS } from "@/lib/rules/state-registry";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, undefined);
  const fe = state?.fieldErrors ?? {};
  const err = (k: string) => fe[k] && <p className="mt-1 text-xs text-red-600">{fe[k]}</p>;
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-900">Company profile</legend>
        <div><Label htmlFor="companyName">Company name</Label><Input id="companyName" name="companyName" aria-invalid={!!fe.companyName} />{err("companyName")}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="usdotNumber">USDOT number (optional)</Label><Input id="usdotNumber" name="usdotNumber" inputMode="numeric" aria-invalid={!!fe.usdotNumber} />{err("usdotNumber")}</div>
          <div>
            <Label htmlFor="baseState">Base state</Label>
            <Select id="baseState" name="baseState" defaultValue="" aria-invalid={!!fe.baseState}>
              <option value="" disabled>Choose…</option>
              {JURISDICTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </Select>
            {err("baseState")}
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="preEmploymentAlcoholTesting" className="mt-1" />
          <span>We conduct pre-employment <strong>alcohol</strong> tests (optional under 49 CFR 382.301(d); if adopted it must apply to every new hire).</span>
        </label>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-900">Your account (owner)</legend>
        <div><Label htmlFor="name">Full name</Label><Input id="name" name="name" autoComplete="name" />{err("name")}</div>
        <div><Label htmlFor="email">Work email</Label><Input id="email" name="email" type="email" autoComplete="username" />{err("email")}</div>
        <div><Label htmlFor="password">Password (12+ characters)</Label><Input id="password" name="password" type="password" autoComplete="new-password" />{err("password")}</div>
      </fieldset>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating…" : "Create company account"}</Button>
    </form>
  );
}
