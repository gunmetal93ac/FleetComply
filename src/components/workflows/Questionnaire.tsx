"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createRunAction } from "@/app/actions/runs";
import {
  ALCOHOL_POLICY_ID,
  clearDraft,
  clearPendingSave,
  emptyDraft,
  loadDraft,
  missingQuestions,
  saveDraft,
  setDraftAnswer,
  type AnswerDraft,
} from "@/lib/workflows/answer-store";
import { WORKFLOWS, visibleQuestions, type Answers } from "@/lib/workflows/definitions";
import type { WorkflowKey } from "@/lib/rules/types";
import { Alert, Button, Card, CardBody, Input, Label, Progress, Select } from "@/components/ui";
import { FieldError, QuestionField } from "./QuestionField";
import { ScenarioDetails } from "./ScenarioDetails";

interface Props {
  workflowKey: WorkflowKey;
  preset: Answers;
  drivers: Array<{ id: string; name: string }>;
  defaultCompanyState?: string | null;
  /** Scenario the questionnaire was opened from; also identifies the shared answer record. */
  scenarioN?: number | null;
  /** Company-profile setting that saved checklists use for pre-employment alcohol testing. */
  orgAlcoholTesting?: boolean;
}

/**
 * Builds a saved (tracked) checklist.
 *
 * Answers already given in the public guide are read from the shared answer record and are not
 * asked again: the page shows them under "Your Scenario Details" and asks only for what is
 * genuinely missing (an unanswered question, or which driver this is about).
 */
export function Questionnaire({ workflowKey, preset, drivers, defaultCompanyState, scenarioN = null, orgAlcoholTesting = false }: Props) {
  const def = WORKFLOWS[workflowKey];
  const [answers, setAnswers] = useState<Answers>({
    ...(def.key === "HIRE_CDL_DRIVER" && defaultCompanyState ? { companyState: defaultCompanyState } : {}),
    ...preset,
  });
  const [driver, setDriver] = useState({ firstName: "", lastName: "", driverId: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  /** Answers came from the guide — show them as a summary instead of asking again. */
  const [carried, setCarried] = useState(false);
  const [editing, setEditing] = useState(false);
  /** Questions to ask in the summary view: the ones that were missing, kept on screen while being answered. */
  const [askIds, setAskIds] = useState<string[]>([]);
  const draft = useRef<AnswerDraft | null>(null);

  useEffect(() => {
    const d = loadDraft(window.localStorage, def, scenarioN);
    draft.current = d;
    if (!d || Object.keys(d.answers).length === 0) return;
    setAnswers((a) => ({ ...a, ...d.answers }));
    setCarried(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowKey, scenarioN]);

  const questions = useMemo(() => visibleQuestions(def, answers), [def, answers]);
  const answered = questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== "").length;
  const missing = useMemo(() => missingQuestions(def, answers), [def, answers]);

  // A changed answer can reveal a follow-up question; add it to the short list rather than restarting.
  useEffect(() => {
    if (!carried) return;
    setAskIds((ids) => {
      const add = missing.map((m) => m.question.id).filter((id) => !ids.includes(id));
      return add.length ? [...ids, ...add] : ids;
    });
  }, [carried, missing]);

  const summaryView = carried && !editing;
  const toAsk = questions.filter((q) => askIds.includes(q.id));

  const set = (id: string, v: string | boolean | undefined) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setErrors((e) => {
      const { [id]: _drop, ...rest } = e;
      return rest;
    });
    const next = setDraftAnswer(draft.current ?? emptyDraft(workflowKey, scenarioN), id, v);
    draft.current = next;
    saveDraft(window.localStorage, next);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    // Only send answers to visible questions.
    const clean: Answers = Object.fromEntries(questions.map((q) => [q.id, answers[q.id]]));
    const fe = def.validate(clean);
    if (def.driver === "create") {
      if (!driver.firstName.trim()) fe.firstName = "Required";
      if (!driver.lastName.trim()) fe.lastName = "Required";
    } else if (def.driver === "existing" && !driver.driverId) fe.driverId = "Choose a driver";
    setErrors(fe);
    if (Object.keys(fe).length) {
      setFormError(summaryView ? "A little more information is needed before the checklist can be built." : "Please answer the highlighted questions.");
      return;
    }
    const ref =
      def.driver === "create"
        ? { firstName: driver.firstName.trim(), lastName: driver.lastName.trim() }
        : driver.driverId
          ? { driverId: driver.driverId }
          : { none: true as const };
    start(async () => {
      // On success the action redirects to the saved checklist and never returns here, so the
      // browser copy is cleared first (the saved checklist then holds the answers) and put back
      // if saving fails.
      const kept = draft.current;
      clearDraft(window.localStorage, workflowKey, scenarioN);
      clearPendingSave(window.localStorage);
      const res = await createRunAction(def.key, clean, ref, scenarioN ?? undefined);
      if (res && !res.ok) {
        if (kept) saveDraft(window.localStorage, kept);
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    });
  }

  const alcoholMismatch = def.key === "HIRE_CDL_DRIVER" && carried && answers[ALCOHOL_POLICY_ID] === true && !orgAlcoholTesting;

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4" noValidate>
      {summaryView ? (
        <>
          <Alert tone="blue">
            {missing.length === 0 && toAsk.length === 0
              ? "Your answers from the guide have been carried over — there is nothing to answer again."
              : "Your answers from the guide have been carried over. Only the questions that still need an answer are shown below."}
          </Alert>
          <ScenarioDetails def={def} answers={answers} onEdit={() => setEditing(true)} defaultOpen />
          {toAsk.length > 0 && (
            <Card>
              <CardBody className="space-y-5">
                <h2 className="text-base font-semibold">Still needed</h2>
                <p className="-mt-3 text-sm text-slate-600">These were not answered, so nothing has been assumed for them.</p>
                {toAsk.map((q) => (
                  <QuestionField key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={(v) => set(q.id, v)} />
                ))}
              </CardBody>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardBody className="space-y-2">
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>{answered} of {questions.length} answered</span>
              <span>You can edit these answers later from the checklist.</span>
            </div>
            <Progress value={(answered / Math.max(1, questions.length)) * 100} />
          </CardBody>
        </Card>
      )}

      {alcoholMismatch && (
        <Alert>
          In the guide you said your company conducts pre-employment alcohol tests. Saved checklists use the company profile, where that is switched off, so the
          step will not be included. Change it under Settings first if it should be.
        </Alert>
      )}

      <Card>
        <CardBody className="space-y-4">
          <h2 className="text-base font-semibold">Driver{def.driver === "optional" ? " (optional)" : ""}</h2>
          {def.driver === "create" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" value={driver.firstName} onChange={(e) => setDriver({ ...driver, firstName: e.target.value })} aria-invalid={!!errors.firstName} />
                <FieldError msg={errors.firstName} />
              </div>
              <div>
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" value={driver.lastName} onChange={(e) => setDriver({ ...driver, lastName: e.target.value })} aria-invalid={!!errors.lastName} />
                <FieldError msg={errors.lastName} />
              </div>
            </div>
          ) : drivers.length ? (
            <div>
              <Label htmlFor="driverId">{def.driver === "optional" ? "Link this checklist to a driver?" : "Which driver?"}</Label>
              <Select id="driverId" value={driver.driverId} onChange={(e) => setDriver({ ...driver, driverId: e.target.value })} aria-invalid={!!errors.driverId}>
                <option value="">{def.driver === "optional" ? "No — this is not about one driver" : "Choose…"}</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
              <FieldError msg={errors.driverId} />
            </div>
          ) : def.driver === "optional" ? (
            <p className="text-sm text-slate-600">No driver is needed for this checklist.</p>
          ) : (
            <Alert>Add the driver on the Drivers page first. Your answers are kept and will be here when you come back.</Alert>
          )}
        </CardBody>
      </Card>

      {!summaryView && (
        <Card>
          <CardBody className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Situation</h2>
              {carried && <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>Done editing</Button>}
            </div>
            {questions.map((q) => (
              <QuestionField key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={(v) => set(q.id, v)} />
            ))}
          </CardBody>
        </Card>
      )}

      {formError && <Alert tone="red">{formError}</Alert>}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Building checklist…" : "Build my checklist"}</Button>
      </div>
    </form>
  );
}
