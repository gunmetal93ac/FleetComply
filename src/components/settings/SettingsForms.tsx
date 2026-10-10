"use client";

import { useActionState, useState, useTransition } from "react";
import { addUserAction, confirmMfaAction, startMfaAction, updateOrgAction, type SettingsState } from "@/app/actions/settings";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { JURISDICTIONS } from "@/lib/rules/state-registry";
import { otpauthUri } from "@/lib/auth/totp-uri";

function Result({ s }: { s: SettingsState }) {
  if (s?.error) return <Alert tone="red">{s.error}</Alert>;
  if (s?.ok) return <Alert tone="green">{s.ok}</Alert>;
  return null;
}

export function OrgForm({ org, disabled }: { org: { name: string; usdotNumber: string | null; baseState: string | null; preEmploymentAlcoholTesting: boolean }; disabled: boolean }) {
  const [s, action, pending] = useActionState(updateOrgAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <Result s={s} />
      <div><Label htmlFor="name">Company name</Label><Input id="name" name="name" defaultValue={org.name} disabled={disabled} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="usdotNumber">USDOT number</Label><Input id="usdotNumber" name="usdotNumber" defaultValue={org.usdotNumber ?? ""} disabled={disabled} /></div>
        <div>
          <Label htmlFor="baseState">Base state</Label>
          <Select id="baseState" name="baseState" defaultValue={org.baseState ?? ""} disabled={disabled}>
            <option value="">Choose…</option>{JURISDICTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </Select>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="preEmploymentAlcoholTesting" defaultChecked={org.preEmploymentAlcoholTesting} disabled={disabled} className="mt-1" /> We conduct pre-employment alcohol tests (49 CFR 382.301(d) — optional, but uniform if adopted)</label>
      {!disabled && <Button type="submit" disabled={pending}>Save</Button>}
    </form>
  );
}

export function AddUserForm() {
  const [s, action, pending] = useActionState(addUserAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Result s={s} /></div>
      <div><Label htmlFor="u-name">Name</Label><Input id="u-name" name="name" /></div>
      <div><Label htmlFor="u-email">Email</Label><Input id="u-email" name="email" type="email" /></div>
      <div>
        <Label htmlFor="u-role">Role</Label>
        <Select id="u-role" name="role" defaultValue="SAFETY_MANAGER">
          <option value="ADMIN">Administrator</option>
          <option value="SAFETY_MANAGER">Safety / DOT compliance manager (can verify)</option>
          <option value="HR">Human resources</option>
          <option value="DISPATCH">Dispatch (read-only on drivers)</option>
          <option value="VIEWER">Read-only</option>
        </Select>
      </div>
      <div><Label htmlFor="u-pw">Temporary password (12+)</Label><Input id="u-pw" name="password" type="password" autoComplete="new-password" /></div>
      <div><Button type="submit" disabled={pending}>Add user</Button></div>
    </form>
  );
}

export function MfaSetup({ enabled, email }: { enabled: boolean; email: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [s, confirm, confirming] = useActionState(confirmMfaAction, undefined);
  if (enabled || s?.ok) return <Alert tone="green">Two-step verification is on for your account.</Alert>;
  if (!secret)
    return (
      <Button variant="outline" disabled={pending} onClick={() => start(async () => setSecret((await startMfaAction())?.secret ?? null))}>
        Turn on two-step verification
      </Button>
    );
  return (
    <form action={confirm} className="space-y-3 text-sm">
      <Result s={s} />
      <p>Add this key to your authenticator app (manual entry), then enter the 6-digit code it shows:</p>
      <p className="break-all rounded bg-slate-100 p-2 font-mono">{secret}</p>
      <p className="break-all text-xs text-slate-500">{otpauthUri(secret, email)}</p>
      <div className="flex gap-2"><Input name="code" inputMode="numeric" maxLength={6} className="w-32" /><Button type="submit" disabled={confirming}>Confirm</Button></div>
    </form>
  );
}
