"use client";

import { useActionState } from "react";
import { mfaAction } from "@/app/actions/auth";
import { Alert, Button, Input, Label } from "@/components/ui";

export function MfaForm() {
  const [state, action, pending] = useActionState(mfaAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      <div>
        <Label htmlFor="code">6-digit code from your authenticator app</Label>
        <Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required autoFocus />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>Verify</Button>
    </form>
  );
}
