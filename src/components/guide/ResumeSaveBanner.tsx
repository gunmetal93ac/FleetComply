"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearPendingSave, getPendingSave, type PendingSave } from "@/lib/workflows/answer-store";
import { KEY_TO_SLUG } from "@/lib/workflows/slugs";

/**
 * Signing in on the way to saving a checklist lands on the home page. This brings the visitor
 * back to the checklist they were saving, with their answers still in place.
 */
export function ResumeSaveBanner() {
  const [pending, setPending] = useState<PendingSave | null>(null);
  useEffect(() => setPending(getPendingSave(window.localStorage)), []);
  if (!pending || !KEY_TO_SLUG[pending.workflowKey]) return null;
  return (
    <div className="border-b border-brand-100 bg-brand-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-navy-800">
        <span>
          You were saving a checklist for <strong>{pending.title}</strong>. Your answers are still here.
        </span>
        <span className="flex items-center gap-4">
          <Link href={`/workflows/${KEY_TO_SLUG[pending.workflowKey]}/start${pending.scenario ? `?scenario=${pending.scenario}` : ""}`} className="font-semibold text-brand-700 hover:underline">
            Continue to my checklist
          </Link>
          <button
            type="button"
            className="text-slate-500 hover:text-slate-700"
            onClick={() => {
              clearPendingSave(window.localStorage);
              setPending(null);
            }}
          >
            Dismiss
          </button>
        </span>
      </div>
    </div>
  );
}
