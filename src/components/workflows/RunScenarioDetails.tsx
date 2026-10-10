"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviseAnswersAction, type AnswerChangePreview } from "@/app/actions/runs";
import { WORKFLOWS, visibleQuestions, type Answers } from "@/lib/workflows/definitions";
import { STATUS_LABEL } from "@/lib/workflows/status";
import type { WorkflowKey } from "@/lib/rules/types";
import { Alert, Button, Card, CardBody } from "@/components/ui";
import { QuestionField } from "./QuestionField";
import { ScenarioDetails } from "./ScenarioDetails";

/**
 * "Your Scenario Details" on a saved checklist, with Edit Answers.
 *
 * Editing never starts the questionnaire over: the saved answers are shown filled in, the change
 * is previewed (which steps appear, drop out or change), and nothing is saved until confirmed.
 */
export function RunScenarioDetails({ runId, workflowKey, answers: saved, canEdit, lockedReason }: { runId: string; workflowKey: WorkflowKey; answers: Answers; canEdit: boolean; lockedReason?: string }) {
  const def = WORKFLOWS[workflowKey];
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<Answers>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AnswerChangePreview | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const questions = useMemo(() => visibleQuestions(def, answers), [def, answers]);
  const clean = (): Answers => Object.fromEntries(questions.map((q) => [q.id, answers[q.id]]));

  const set = (id: string, v: string | boolean | undefined) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setErrors(({ [id]: _drop, ...rest }) => rest);
    setPreview(null); // a preview only describes the answers it was made from
  };

  const cancel = () => {
    setEditing(false);
    setAnswers(saved);
    setErrors({});
    setError(null);
    setPreview(null);
  };

  const send = (apply: boolean) =>
    start(async () => {
      setError(null);
      const res = await reviseAnswersAction(runId, clean(), apply);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setError(res.error);
        setPreview(null);
        return;
      }
      if (!apply) {
        setPreview(res.preview);
        return;
      }
      setEditing(false);
      setPreview(null);
      setSavedNote(res.preview.answerChanges ? "Answers updated. The checklist below reflects them; completed work and history were kept." : null);
      router.refresh();
    });

  if (!editing)
    return (
      <div className="mb-4 space-y-2">
        {savedNote && <Alert tone="green">{savedNote}</Alert>}
        <ScenarioDetails
          def={def}
          answers={saved}
          onEdit={canEdit ? () => { setAnswers(saved); setSavedNote(null); setEditing(true); } : undefined}
          note={!canEdit && lockedReason ? lockedReason : undefined}
        />
      </div>
    );

  const p = preview;
  const nothing = p && !p.answerChanges && !p.nowApplies.length && !p.noLongerApplies.length && !p.reclassified.length && !p.deadlinesChanged.length && !p.added.length;
  return (
    <Card className="mb-4">
      <CardBody className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-navy-800">Edit Answers</h2>
          <p className="mt-1 text-sm text-slate-600">Your saved answers are filled in. Change only what is different — the checklist is re-evaluated, and nothing already completed is erased.</p>
        </div>
        {questions.map((q) => (
          <QuestionField key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={(v) => set(q.id, v)} />
        ))}

        {p && (
          <div className="space-y-3 rounded-lg bg-slate-50 p-4 text-sm ring-1 ring-inset ring-slate-200">
            <p className="font-semibold text-navy-800">What this change will do</p>
            {nothing && <p className="text-slate-600">Nothing — these answers produce the same checklist.</p>}
            <Impact title="Steps that will now apply" items={p.nowApplies} />
            <Impact title="Steps that will no longer apply" items={p.noLongerApplies} />
            <Impact title="Steps whose classification will change" items={p.reclassified} />
            <Impact title="Deadlines that will be recalculated" items={p.deadlinesChanged} />
            <Impact title="Requirements added to the rule catalog since this checklist was created" items={p.added} />
            {p.affectsRecordedWork.length > 0 && (
              <Alert tone="amber" title="This affects work already recorded">
                <ul className="list-disc space-y-1 pl-5">
                  {p.affectsRecordedWork.map((x) => (
                    <li key={x.title}>
                      {x.title} — currently {STATUS_LABEL[x.status].toLowerCase()}; {x.effect === "NO_LONGER_APPLIES" ? "will no longer apply" : "will be reclassified"}.
                    </li>
                  ))}
                </ul>
                <p className="mt-2">The status, notes, documents and history of these steps are kept. Review them after saving.</p>
              </Alert>
            )}
          </div>
        )}

        {error && <Alert tone="red">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          {p ? (
            <Button type="button" disabled={pending || !!nothing} onClick={() => send(true)}>{pending ? "Updating…" : "Update checklist"}</Button>
          ) : (
            <Button type="button" disabled={pending} onClick={() => send(false)}>{pending ? "Checking…" : "Review changes"}</Button>
          )}
          <Button type="button" variant="outline" disabled={pending} onClick={cancel}>Cancel</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Impact({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="font-medium text-slate-700">{title} ({items.length})</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">{items.map((t) => <li key={t}>{t}</li>)}</ul>
    </div>
  );
}
