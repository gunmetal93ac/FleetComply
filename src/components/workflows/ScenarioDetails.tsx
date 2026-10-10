"use client";

import { summarizeAnswers } from "@/lib/workflows/answer-store";
import type { Answers, WorkflowDefinition } from "@/lib/workflows/definitions";
import { IconChevronDown } from "@/components/icons";
import { Button, cn } from "@/components/ui";

/**
 * "Your Scenario Details" — the answers a checklist was built from, with a way to change them.
 * Shared by the public guide, the save page and saved checklists so all three read the same answers.
 */
export function ScenarioDetails({
  def,
  answers,
  onEdit,
  defaultOpen = false,
  note,
  className,
}: {
  def: WorkflowDefinition;
  answers: Answers;
  /** Omit to show the answers read-only. */
  onEdit?: () => void;
  defaultOpen?: boolean;
  note?: React.ReactNode;
  className?: string;
}) {
  const rows = summarizeAnswers(def, answers);
  const answered = rows.filter((r) => r.answered).length;
  return (
    <details open={defaultOpen} className={cn("group rounded-xl border border-slate-200 bg-white shadow-card", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5">
        <span className="text-sm font-semibold text-navy-800">
          Your Scenario Details
          <span className="ml-2 font-normal text-slate-500">
            {answered} answer{answered === 1 ? "" : "s"} used to build this checklist
          </span>
        </span>
        <IconChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 px-5 py-4">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id}>
              <dt className="text-xs text-slate-500">{r.label}</dt>
              <dd className={cn("mt-0.5 font-medium", r.answered ? "text-navy-800" : "text-slate-400")} suppressHydrationWarning>
                {r.answered && r.type === "datetime" ? formatDateTime(r.display) : r.display}
              </dd>
            </div>
          ))}
        </dl>
        {note && <div className="mt-3 text-xs text-slate-500">{note}</div>}
        {onEdit && (
          <div className="no-print mt-4">
            <Button type="button" size="sm" variant="outline" onClick={onEdit}>Edit Answers</Button>
          </div>
        )}
      </div>
    </details>
  );
}

/** Date-times are stored as ISO (UTC) and shown in the viewer's own time zone. */
function formatDateTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
