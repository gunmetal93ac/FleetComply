"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { draftCitationRepairAction, monitorCoverageAction, reviewFindingAction, type VerificationResult } from "@/app/actions/verification";
import { DISPOSITION_LABEL, type CoverageGroup, type Disposition, type Finding, type FindingReview } from "@/lib/regulatory/findings";
import { Alert, Badge, Button, Label, Select, Textarea, type Tone } from "@/components/ui";

const SEVERITY: Record<Finding["severity"], { tone: Tone; label: string }> = {
  PROBLEM: { tone: "red", label: "Established by the check" },
  POSSIBLE: { tone: "amber", label: "Possible — needs your judgment" },
  INFO: { tone: "slate", label: "For information" },
};
const APPLIES: Record<Finding["appliesTo"], string> = { CURRENT: "Current wording", PROPOSED: "Proposed correction", BOTH: "Current wording and proposed correction" };
const DISPOSITION_TONE: Record<Disposition, Tone> = { RESOLVED: "green", NOT_APPLICABLE: "slate", NEEDS_REVIEW: "amber" };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export interface FindingView {
  finding: Finding;
  history: Array<FindingReview & { byName: string }>;
  /** The finding concerns only the current wording and a proposed correction removes it. */
  addressedByDraft: boolean;
}

/**
 * Each deterministic finding with its explanation, the official sources involved, the recommended
 * next action and the administrator's handling of it. Marking a finding is bookkeeping: it is
 * recorded with a reason and kept in the history, and it never approves or publishes anything.
 */
export function FindingsPanel({ ruleId, findings }: { ruleId: string; findings: FindingView[] }) {
  if (findings.length === 0) return <p className="text-sm text-slate-500">No findings. Run “Check Official Sources” to check the cited sections against the eCFR.</p>;
  const open = findings.filter((f) => f.finding.severity !== "INFO" && !f.addressedByDraft && !["RESOLVED", "NOT_APPLICABLE"].includes(f.history.at(-1)?.disposition ?? ""));
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {open.length === 0 ? "Every finding that needs a decision has been dealt with." : `${open.length} finding${open.length === 1 ? "" : "s"} still need${open.length === 1 ? "s" : ""} a decision.`} Fixed checks can
        establish facts about a citation; they cannot establish that a statement of law is correct. Content cannot be approved while a finding about it is open.
      </p>
      {findings.map((f) => <FindingCard key={f.finding.key} ruleId={ruleId} view={f} />)}
    </div>
  );
}

function FindingCard({ ruleId, view }: { ruleId: string; view: FindingView }) {
  const { finding: f, history } = view;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [disposition, setDisposition] = useState<Disposition>("RESOLVED");
  const [note, setNote] = useState("");
  const latest = history.at(-1);
  return (
    <div className="rounded-lg border border-slate-200 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Badge>
        <Badge>{APPLIES[f.appliesTo]}</Badge>
        {latest ? <Badge tone={DISPOSITION_TONE[latest.disposition]}>{DISPOSITION_LABEL[latest.disposition]}</Badge> : f.severity !== "INFO" && !view.addressedByDraft && <Badge tone="amber">Open</Badge>}
        {view.addressedByDraft && <Badge tone="green">Removed by the proposed correction</Badge>}
      </div>
      <p className="mt-2 font-semibold text-navy-800">{f.message}</p>
      <p className="mt-1 text-slate-700"><span className="font-medium">Why it matters:</span> {f.explanation}</p>
      {f.sources.length > 0 && (
        <p className="mt-1 break-words text-slate-700">
          <span className="font-medium">Official sources:</span>{" "}
          {f.sources.map((s, k) => <span key={s.url + k}>{k > 0 && " · "}<a className="text-brand-700 underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a></span>)}
        </p>
      )}
      <p className="mt-1 text-slate-700"><span className="font-medium">Recommended next action:</span> {f.nextAction}</p>

      {history.length > 0 && (
        <ol className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
          {history.map((h, k) => (
            <li key={k}>
              <span className="font-medium text-slate-800">{when(h.at)}</span> · {h.byName} · {DISPOSITION_LABEL[h.disposition]}{h.note && <> — “{h.note}”</>}
            </li>
          ))}
        </ol>
      )}

      {f.severity !== "INFO" && (
        <details className="mt-3 border-t border-slate-100 pt-2">
          <summary className="cursor-pointer text-sm font-medium text-brand-700">{latest ? "Change how this finding is handled" : "Record how this finding is handled"}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-[220px_1fr]">
            <div>
              <Label htmlFor={`d-${f.key}`}>Handling</Label>
              <Select id={`d-${f.key}`} value={disposition} onChange={(e) => setDisposition(e.target.value as Disposition)}>
                {(Object.keys(DISPOSITION_LABEL) as Disposition[]).map((d) => <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor={`n-${f.key}`}>{disposition === "NOT_APPLICABLE" ? "Reason it does not apply (required)" : disposition === "RESOLVED" ? "How it was resolved (required)" : "What still needs looking at"}</Label>
              <Textarea id={`n-${f.key}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setResult(null);
                const res = await reviewFindingAction(ruleId, f.key, disposition, note);
                setResult(res);
                if (res.ok) setNote("");
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save"}
          </Button>
          {result && <p className={`mt-2 text-sm ${result.ok ? "text-accent-700" : "text-red-700"}`}>{result.ok ? result.message : result.error}</p>}
        </details>
      )}
    </div>
  );
}

const ACTIVITY: Record<string, { tone: Tone; label: string }> = { ACTIVE: { tone: "green", label: "Active" }, RESERVED: { tone: "amber", label: "Reserved — no requirement" }, REMOVED: { tone: "red", label: "Removed" } };

/**
 * A range, subpart or part citation broken into its individual sections, with status, official
 * link and whether Regulatory Intelligence watches it. Active sections of a range or subpart are
 * pre-selected; sections of a whole part never are — citing a part does not mean each section applies.
 */
export function CoveragePanel({ ruleId, groups, unmonitored, canRepair }: { ruleId: string; groups: CoverageGroup[]; unmonitored: string[]; canRepair: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<VerificationResult | null>(null);
  const selectable = [...new Set([...groups.flatMap((g) => g.sections.filter((s) => s.activity === "ACTIVE" && !s.monitored).map((s) => s.section)), ...unmonitored])];
  const [selected, setSelected] = useState<string[]>(() => [...new Set([...groups.flatMap((g) => g.sections.filter((s) => s.suggested && !s.monitored).map((s) => s.section)), ...unmonitored])]);
  const toggle = (s: string) => setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const run = (fn: () => Promise<VerificationResult>) =>
    start(async () => {
      setResult(null);
      setResult(await fn());
      router.refresh();
    });
  if (groups.length === 0 && unmonitored.length === 0) return null;
  return (
    <div className="space-y-4 text-sm">
      {groups.map((g) => (
        <div key={g.citation}>
          <p className="font-medium text-navy-800">
            “{g.citation}” — {g.kind === "RANGE" ? `§§ ${g.from}–${g.to}` : g.kind === "SUBPART" ? `Subpart ${g.subpart} of Part ${g.part}` : `all of Part ${g.part}`}
            <span className="ml-2 font-normal text-slate-500">{g.origin === "CURRENT" ? "cited now" : g.origin === "PROPOSED" ? "in the proposed correction" : "cited now and in the correction"}</span>
          </p>
          {g.kind === "PART" && <p className="mt-1 text-xs text-slate-600">A part-level citation. No section is assumed to apply: tick only the sections this step actually relies on.</p>}
          {g.sections.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">The section list was not retrieved. Run “Check Official Sources” again.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {g.sections.map((s) => (
                <li key={s.section} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    aria-label={`Monitor § ${s.section}`}
                    disabled={s.activity !== "ACTIVE" || s.monitored}
                    checked={s.monitored || selected.includes(s.section)}
                    onChange={() => toggle(s.section)}
                  />
                  <a className="font-medium text-brand-700 underline" href={s.officialUrl} target="_blank" rel="noreferrer noopener">§ {s.section}</a>
                  <span className="min-w-0 flex-1 text-slate-600">{(s.heading ?? "").replace(/^§\s*[\d.]+[A-Za-z]?\s*/, "")}</span>
                  <Badge tone={ACTIVITY[s.activity].tone}>{ACTIVITY[s.activity].label}</Badge>
                  {s.monitored ? <Badge tone="blue">Monitored</Badge> : s.activity === "ACTIVE" && <Badge>Not monitored</Badge>}
                  {s.linkedNow && <Badge>Linked now</Badge>}
                  {s.inCorrection && <Badge tone="purple">Cited in correction</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {unmonitored.length > 0 && (
        <div>
          <p className="font-medium text-navy-800">Cited individually but not yet monitored for this step</p>
          <ul className="mt-2 flex flex-wrap gap-3">
            {unmonitored.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" aria-label={`Monitor § ${s}`} checked={selected.includes(s)} onChange={() => toggle(s)} />§ {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending || selected.filter((s) => selectable.includes(s)).length === 0} onClick={() => run(() => monitorCoverageAction(ruleId, selected.filter((s) => selectable.includes(s))))}>
          Monitor {selected.filter((s) => selectable.includes(s)).length} selected section{selected.filter((s) => selectable.includes(s)).length === 1 ? "" : "s"}
        </Button>
        {canRepair && (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => draftCitationRepairAction(ruleId))}>
            Draft citation repair
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Monitoring a section only makes Regulatory Intelligence watch it for changes. “Draft citation repair” rewrites range and subpart citations as individual active sections in the proposed correction —
        a draft you still have to review, approve and publish. Reserved and removed sections cannot be monitored or cited as requirements.
      </p>
      {result && <Alert tone={result.ok ? "green" : "red"}>{result.ok ? result.message : result.error}</Alert>}
    </div>
  );
}
