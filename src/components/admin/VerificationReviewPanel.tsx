"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkSourcesAction, decideAction, publishCorrectionAction, saveCorrectionAction, type VerificationResult } from "@/app/actions/verification";
import { APPROVE_CONFIRMATION, DECISION_LABEL, PUBLISH_CONFIRMATION, type Decision, type Wording } from "@/lib/regulatory/verification";
import { Alert, Button, Input, Label, Textarea } from "@/components/ui";

/** "Check Official Sources" — read-only retrieval; the result is evidence, never an approval. */
export function CheckSourcesButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<VerificationResult | null>(null);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await checkSourcesAction(ruleId));
            router.refresh();
          })
        }
      >
        {pending ? "Retrieving from eCFR…" : "Check Official Sources"}
      </Button>
      {pending && <p className="text-xs text-slate-500">Requests are made one at a time; this can take up to a minute.</p>}
      {result && <p className={`text-sm ${result.ok ? "text-accent-700" : "text-red-700"}`}>{result.ok ? result.message : result.error}</p>}
    </div>
  );
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const sourcesToText = (w: Wording) => w.sources.map((s) => `${s.citation} | ${s.url}`).join("\n");
const textToSources = (s: string) =>
  lines(s).map((l) => {
    const i = l.lastIndexOf("|");
    return i < 0 ? { citation: l, url: "" } : { citation: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
  });

/** Editable draft of replacement wording and citations. A draft is never shown to customers. */
export function CorrectionEditor({ ruleId, initial, isDraft, locked }: { ruleId: string; initial: Wording; isDraft: boolean; locked?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [w, setW] = useState({
    title: initial.title,
    purpose: initial.purpose,
    applicability: initial.applicability,
    requiredAction: initial.requiredAction.join("\n"),
    documentation: initial.documentation.join("\n"),
    exceptions: initial.exceptions,
    verification: initial.verification,
    sources: sourcesToText(initial),
  });
  const set = (k: keyof typeof w) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setW({ ...w, [k]: e.target.value });
  const err = result && !result.ok ? result.fieldErrors ?? {} : {};
  const field = (k: keyof typeof w, label: string, rows: number, help?: string) => (
    <div>
      <Label htmlFor={`c-${k}`}>{label}</Label>
      {help && <p className="mb-1 text-xs text-slate-500">{help}</p>}
      <Textarea id={`c-${k}`} rows={rows} value={w[k]} onChange={set(k)} disabled={!!locked} aria-invalid={!!err[k]} />
      {err[k] && <p className="mt-1 text-xs text-red-600">{err[k]}</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      {!isDraft && <p className="text-sm text-slate-600">No correction has been drafted. The fields below start from the current wording — edit what needs to change and save.</p>}
      <div>
        <Label htmlFor="c-title">Step title</Label>
        <Input id="c-title" value={w.title} onChange={set("title")} disabled={!!locked} aria-invalid={!!err.title} />
        {err.title && <p className="mt-1 text-xs text-red-600">{err.title}</p>}
      </div>
      {field("requiredAction", "Required action", 8, "One action per line.")}
      {field("purpose", "Reason (one line shown under the title)", 2)}
      {field("applicability", "Applicability", 2)}
      {field("documentation", "Required documentation", 4, "One item per line.")}
      {field("exceptions", "Exceptions", 3)}
      {field("verification", "How to verify", 2)}
      {field("sources", "Citations", 6, "One per line: citation text | official https link. eCFR section links are checked and monitored automatically.")}
      {locked ? (
        <p className="text-sm text-slate-500">{locked}</p>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setResult(null);
              setResult(
                await saveCorrectionAction(ruleId, {
                  title: w.title, purpose: w.purpose, applicability: w.applicability, requiredAction: lines(w.requiredAction), documentation: lines(w.documentation),
                  exceptions: w.exceptions, verification: w.verification, sources: textToSources(w.sources),
                }),
              );
              router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save proposed correction (draft)"}
        </Button>
      )}
      {result && <p className={`text-sm ${result.ok ? "text-accent-700" : "text-red-700"}`}>{result.ok ? result.message : result.error}</p>}
    </div>
  );
}

/** Reviewer notes and the four review actions. Approval needs a note and a typed confirmation. */
export function DecisionPanel({ ruleId, hasDraft, alreadyApproved }: { ruleId: string; hasDraft: boolean; alreadyApproved: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [note, setNote] = useState("");
  const [sources, setSources] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const send = (decision: Decision) =>
    start(async () => {
      setResult(null);
      const res = await decideAction(ruleId, { decision, note, sources: lines(sources), confirmation });
      setResult(res);
      if (res.ok) {
        setNote("");
        setConfirmation("");
      }
      router.refresh();
    });
  const err = result && !result.ok ? result.fieldErrors ?? {} : {};
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="rv-note">Reviewer notes</Label>
        <p className="mb-1 text-xs text-slate-500">Why you are approving or rejecting: what you read, and what it does and does not establish. Kept permanently in the review history.</p>
        <Textarea id="rv-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!err.note} />
        {err.note && <p className="mt-1 text-xs text-red-600">{err.note}</p>}
      </div>
      <div>
        <Label htmlFor="rv-sources">Other official sources relied on (optional)</Label>
        <p className="mb-1 text-xs text-slate-500">One https .gov link per line — for example FMCSA guidance or a State agency page. Sections retrieved by the source check are recorded automatically.</p>
        <Textarea id="rv-sources" rows={2} value={sources} onChange={(e) => setSources(e.target.value)} aria-invalid={!!err.sources} />
        {err.sources && <p className="mt-1 text-xs text-red-600">{err.sources}</p>}
      </div>

      <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
        <p className="text-sm font-semibold text-navy-800">{DECISION_LABEL.APPROVE}</p>
        <p className="mt-1 text-sm text-slate-600">
          You are confirming that you have read the official text and that {hasDraft ? "the proposed correction" : "the current wording"} states it correctly. This records “Approved — awaiting publication”.
          It does not change what customers see, and it does not decide whether any customer qualifies for anything.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="rv-confirm">Type {APPROVE_CONFIRMATION} to confirm</Label>
            <Input id="rv-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="w-40" autoComplete="off" aria-invalid={!!err.confirmation} />
          </div>
          <Button type="button" disabled={pending || alreadyApproved || confirmation !== APPROVE_CONFIRMATION || note.trim().length < 10} onClick={() => send("APPROVE")}>
            {DECISION_LABEL.APPROVE}
          </Button>
        </div>
        {alreadyApproved && <p className="mt-2 text-xs text-slate-500">Already approved. Publish it below, or record another decision to withdraw the approval.</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["REQUEST_CORRECTION", "INSUFFICIENT_EVIDENCE", "REJECT"] as Decision[]).map((d) => (
          <Button key={d} type="button" variant="outline" disabled={pending || note.trim().length < 10} onClick={() => send(d)}>{DECISION_LABEL[d]}</Button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        “Reject incorrect guidance” also puts a notice on the step telling customers it is being corrected and not to rely on it, until a correction is published.
      </p>
      {result && <Alert tone={result.ok ? "green" : "red"}>{result.ok ? result.message : result.error}</Alert>}
    </div>
  );
}

/** The separate publication step, shown only for approved content. */
export function PublishPanel({ ruleId, toVersion }: { ruleId: string; toVersion: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [confirmation, setConfirmation] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        Publishing creates version {toVersion} of this step with the replacement shown above. New checklists will use it. Earlier versions stay on record, and saved checklists keep the version they were
        created with.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="pub-confirm">Type {PUBLISH_CONFIRMATION} to confirm</Label>
          <Input id="pub-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="w-40" autoComplete="off" />
        </div>
        <Button
          type="button"
          disabled={pending || confirmation !== PUBLISH_CONFIRMATION}
          onClick={() =>
            start(async () => {
              setResult(null);
              setResult(await publishCorrectionAction(ruleId, confirmation));
              setConfirmation("");
              router.refresh();
            })
          }
        >
          {pending ? "Publishing…" : "Publish Correction"}
        </Button>
      </div>
      {result && <Alert tone={result.ok ? "green" : "red"}>{result.ok ? result.message : result.error}</Alert>}
    </div>
  );
}
