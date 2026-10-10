"use client";

import { useState, useTransition } from "react";
import { runRegulatoryCheckAction, type RunCheckResult } from "@/app/actions/regulatory";
import { Button } from "@/components/ui";

/** Administrator-only manual trigger. The server action re-checks authorization. */
export function RunCheckButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RunCheckResult | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await runRegulatoryCheckAction());
          })
        }
      >
        {pending ? "Checking official sources…" : "Run check now"}
      </Button>
      {pending && <p className="text-xs text-slate-500">Requests are made one at a time; a routine check takes under a minute.</p>}
      {result && <p className={`max-w-md text-right text-xs ${result.ok ? "text-accent-700" : "text-red-700"}`}>{result.ok ? result.message : result.error}</p>}
    </div>
  );
}
