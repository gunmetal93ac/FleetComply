"use client";

import type { Answers, Question } from "@/lib/workflows/definitions";
import { Input, Label, Select } from "@/components/ui";

/** One questionnaire field. Shared by the public compliance guide and the tracked-checklist questionnaire. */

export function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-xs text-red-600">{msg}</p> : null;
}

export function QuestionField({ q, value, error, onChange }: { q: Question; value: Answers[string]; error?: string; onChange: (v: string | boolean | undefined) => void }) {
  const id = `q-${q.id}`;
  return (
    <div>
      <Label htmlFor={id}>{q.label}</Label>
      {q.help && <p className="mb-2 text-xs text-slate-500">{q.help}</p>}
      {q.type === "boolean" ? (
        <div className="flex gap-2" role="radiogroup" aria-labelledby={id}>
          {[true, false].map((b) => (
            <button
              type="button"
              key={String(b)}
              id={b ? id : undefined}
              role="radio"
              aria-checked={value === b}
              onClick={() => onChange(b)}
              className={`rounded-md border px-4 py-2 text-sm ${value === b ? "border-brand-600 bg-brand-50 font-semibold text-brand-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {b ? "Yes" : "No"}
            </button>
          ))}
        </div>
      ) : q.type === "select" || q.type === "state" ? (
        <Select id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} aria-invalid={!!error}>
          <option value="">Choose…</option>
          {q.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ) : (
        <Input
          id={id}
          type={q.type === "date" ? "date" : q.type === "datetime" ? "datetime-local" : "text"}
          value={typeof value === "string" ? toInputValue(q.type, value) : ""}
          onChange={(e) => onChange(fromInputValue(q.type, e.target.value))}
          aria-invalid={!!error}
        />
      )}
      <FieldError msg={error} />
    </div>
  );
}

/** datetime-local works in the user's local time; we store ISO (UTC) so deadlines are exact. */
function toInputValue(type: string, v: string) {
  if (type !== "datetime") return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromInputValue(type: string, v: string) {
  if (!v) return undefined;
  if (type !== "datetime") return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}
