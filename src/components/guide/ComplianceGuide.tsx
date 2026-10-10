"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateChecklist, ValidationError, type GeneratedChecklist, type GeneratedItem } from "@/lib/workflows/checklist";
import { WORKFLOWS, visibleQuestions, type Answers } from "@/lib/workflows/definitions";
import { KEY_TO_SLUG } from "@/lib/workflows/slugs";
import type { RegulatoryRule, WorkflowKey } from "@/lib/rules/types";
import { Alert, Badge, Button, Card, CardBody, Progress, cn } from "@/components/ui";
import { QuestionField } from "@/components/workflows/QuestionField";
import { ScenarioDetails } from "@/components/workflows/ScenarioDetails";
import { ActionRow, ContentReviewBadge, DeadlineBadge, NextActionPanel, ProgressHeader, RequiredActions, RuleDetails, SourceLinks, StageHeading, TierBadge, TierHeading, type NextItem } from "@/components/checklist/Checklist";
import { ALCOHOL_POLICY_ID, clearDraft, emptyDraft, loadDraft, saveDraft, setDraftAnswer, setPendingSave, type AnswerDraft } from "@/lib/workflows/answer-store";
import { CHECKLIST_LABELS as L, checklistProgress, isActionable, isEmergency, nextActions, orderForDisplay, priorityOf, safetyStepsBeforeQuestions, type PriorityTier } from "@/lib/workflows/priority";
import { IconArrowRight, IconBan, IconCheck, IconChevronDown, IconClipboard } from "@/components/icons";

interface Props {
  workflowKey: WorkflowKey;
  preset: Answers;
  scenario: { n: number; title: string; determines: string } | null;
  /** Published, administrator-reviewed corrections to steps of this workflow, keyed by rule id. */
  overrides?: Record<string, RegulatoryRule>;
}


/** Read/write browser storage defensively — private windows and blocked storage must not break the guide. */
type Checks = Record<string, boolean | string>;
function loadChecks(key: string): Checks {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}
function saveChecks(key: string, v: Checks) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* progress tracking is optional */
  }
}

export function ComplianceGuide({ workflowKey, preset, scenario, overrides }: Props) {
  const def = WORKFLOWS[workflowKey];
  const scenarioN = scenario?.n ?? null;
  const initial = (): Answers => ({ ...preset, ...(workflowKey === "HIRE_CDL_DRIVER" ? { [ALCOHOL_POLICY_ID]: false } : {}) });
  const [answers, setAnswers] = useState<Answers>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedChecklist | null>(null);
  /** Answers were restored from an earlier visit to this guide in this browser. */
  const [restored, setRestored] = useState(false);
  // The single record of this questionnaire's answers; the save page reads the same one.
  const draft = useRef<AnswerDraft | null>(null);

  const questions = useMemo(() => visibleQuestions(def, answers), [def, answers]);
  const answered = questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== "").length;

  const generate = (a: Answers) => {
    const clean: Answers = Object.fromEntries(visibleQuestions(def, a).map((q) => [q.id, a[q.id]]));
    return generateChecklist(
      def,
      clean,
      { baseState: typeof clean.companyState === "string" ? clean.companyState : null, preEmploymentAlcoholTesting: a[ALCOHOL_POLICY_ID] === true },
      {},
      overrides,
    );
  };

  // Returning to the guide: pick up the answers already given, and the checklist if it was built.
  useEffect(() => {
    const d = loadDraft(window.localStorage, def, scenarioN);
    draft.current = d;
    if (!d || Object.keys(d.answers).length === 0) return;
    const merged = { ...initial(), ...d.answers };
    setAnswers(merged);
    setRestored(true);
    if (d.built) {
      try {
        setResult(generate(merged));
      } catch {
        /* answers no longer complete — show the questions, with what was answered filled in */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowKey, scenarioN]);

  const persist = (next: AnswerDraft) => {
    draft.current = next;
    saveDraft(window.localStorage, next);
  };

  const set = (id: string, v: string | boolean | undefined) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setErrors(({ [id]: _drop, ...rest }) => rest);
    persist(setDraftAnswer(draft.current ?? emptyDraft(workflowKey, scenarioN), id, v));
  };

  function startOver() {
    if (!window.confirm("Clear your answers and checkmarks for this guide in this browser and start again?")) return;
    clearDraft(window.localStorage, workflowKey, scenarioN);
    saveChecks(`fleetcomply:guide:${def.key}`, {});
    draft.current = null;
    setAnswers(initial());
    setErrors({});
    setFormError(null);
    setRestored(false);
    setResult(null);
  }

  function build(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const checklist = generate(answers);
      setErrors({});
      persist({ ...(draft.current ?? emptyDraft(workflowKey, scenarioN)), built: true, updatedAt: new Date().toISOString() });
      setResult(checklist);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ValidationError) {
        setErrors(err.fieldErrors);
        setFormError("Please answer the highlighted questions — each one changes which requirements apply.");
      } else {
        setFormError("Something went wrong building the guide.");
        console.error(err);
      }
    }
  }

  // Immediate-safety steps the rules do not rule out for this scenario are shown before any question.
  const doFirst = safetyStepsBeforeQuestions(workflowKey, preset);

  if (result) return <GuideResult def={def} result={result} scenario={scenario} answers={answers} onEdit={() => setResult(null)} onStartOver={startOver} />;
  return (
    <form onSubmit={build} noValidate className="space-y-5">
      {doFirst.length > 0 && (
        <section aria-label={L.doFirst} className="rounded-xl border border-red-200 bg-red-50/70 p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-red-800">{L.doFirst}</h2>
          {doFirst.map((r) => (
            <div key={r.id} className="mt-3 text-sm text-slate-800">
              <p className="mb-2 text-base font-semibold text-navy-800">{r.title}</p>
              <RequiredActions rule={r} />
              <div className="mt-2 text-xs"><SourceLinks rule={r} /></div>
            </div>
          ))}
          <p className="mt-3 text-xs text-slate-600">These are also on your checklist. Answer the questions below when it is safe to do so.</p>
        </section>
      )}
      {restored && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-slate-700">
          <span>Your earlier answers are filled in. Change any that are different this time.</span>
          <button type="button" onClick={startOver} className="font-medium text-brand-700 hover:underline">Start over</button>
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="flex items-start gap-4 bg-gradient-to-r from-brand-50 to-white px-5 py-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30">
            <IconClipboard className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="font-semibold text-navy-800">A few questions about your situation</p>
            <p className="mt-0.5 text-sm text-slate-600">
              Each answer changes which requirements apply. Choose <em>“Not sure”</em> where you don’t know yet — those requirements are flagged for review instead of guessed.
            </p>
            <div className="mt-3 flex items-center gap-3 text-xs font-medium text-slate-500">
              <Progress value={(answered / Math.max(1, questions.length)) * 100} />
              <span className="whitespace-nowrap">{answered} of {questions.length} answered</span>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardBody className="divide-y divide-slate-100 py-1">
          {questions.map((q, i) => {
            const done = answers[q.id] !== undefined && answers[q.id] !== "";
            return (
              <div key={q.id} className="flex gap-4 py-5">
                <QuestionNumber n={i + 1} done={done} error={!!errors[q.id]} />
                <div className="min-w-0 flex-1">
                  <QuestionField q={q} value={answers[q.id]} error={errors[q.id]} onChange={(v) => set(q.id, v)} />
                </div>
              </div>
            );
          })}
          {workflowKey === "HIRE_CDL_DRIVER" && (
            <div className="flex gap-4 py-5">
              <QuestionNumber n={questions.length + 1} done={answers[ALCOHOL_POLICY_ID] !== undefined} error={false} />
              <div className="min-w-0 flex-1">
                <QuestionField
                  q={{
                    id: ALCOHOL_POLICY_ID,
                    label: "Does your company conduct pre-employment alcohol tests?",
                    help: "Optional under 49 CFR 382.301(d). If your company has chosen to do them, they must be done consistently — the guide will include that step.",
                    type: "boolean",
                    required: false,
                  }}
                  value={answers[ALCOHOL_POLICY_ID]}
                  onChange={(v) => set(ALCOHOL_POLICY_ID, v)}
                />
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {formError && <Alert tone="red">{formError}</Alert>}
      <Button type="submit" className="h-12 bg-gradient-to-r from-brand-600 to-brand-700 px-6 text-base font-semibold">
        Build my checklist <IconArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}

function QuestionNumber({ n, done, error }: { n: number; done: boolean; error: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition",
        error ? "bg-red-50 text-red-700 ring-1 ring-red-200" : done ? "bg-accent-500 text-white" : "bg-brand-50 text-brand-700 ring-1 ring-brand-100",
      )}
    >
      {done && !error ? <IconCheck className="h-3.5 w-3.5" /> : n}
    </span>
  );
}

// ───────────────────────────────── Result ─────────────────────────────────

type GuideAction = GeneratedItem & { rule: RegulatoryRule };

export function GuideResult({
  def,
  result,
  scenario,
  answers,
  onEdit,
  onStartOver,
}: {
  def: (typeof WORKFLOWS)[WorkflowKey];
  result: GeneratedChecklist;
  scenario: Props["scenario"];
  answers: Answers;
  onEdit: () => void;
  onStartOver: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const storageKey = `fleetcomply:guide:${def.key}`;
  const [checks, setChecks] = useState<Checks>({});
  useEffect(() => setChecks(loadChecks(storageKey)), [storageKey]);
  // A check stores when it was made; unchecking clears it. Nothing is checked by viewing a step.
  const toggle = (id: string) =>
    setChecks((c) => {
      const next = { ...c, [id]: c[id] ? false : new Date().toISOString() };
      saveChecks(storageKey, next);
      return next;
    });

  const emergency = isEmergency(def.key, result.facts);
  const all: GuideAction[] = result.items.map((i) => ({ ...i, rule: i.ruleSnapshot }));
  const actions = orderForDisplay(all.filter(isActionable), emergency);
  const notApplicable = all.filter((i) => !isActionable(i));
  const tierOf = new Map(actions.map((i) => [i.ruleId, priorityOf(i)] as const));
  const isDone = (i: GuideAction) => !!checks[i.ruleId];

  const progress = checklistProgress(actions, isDone);
  const next = nextActions(actions, (i) => ({ done: isDone(i) }), new Date(now));
  const toNext = (i: GuideAction): NextItem => ({ id: i.ruleId, title: i.title, tier: tierOf.get(i.ruleId)!.tier, rule: i.rule, dueAt: i.dueAt });
  const restrictions = actions.filter((i) => tierOf.get(i.ruleId)!.tier === 2 && !isDone(i));
  // Steps checked off under earlier answers that the current answers no longer call for. Kept, not erased.
  const checkedButNotApplicable = notApplicable.filter((i) => checks[i.ruleId]);

  const groups: Array<{ key: string; heading: React.ReactNode; items: GuideAction[] }> = emergency
    ? ([1, 2, 3, 4, 5] as PriorityTier[])
        .map((t) => ({ t, items: actions.filter((i) => tierOf.get(i.ruleId)!.tier === t) }))
        .filter((g) => g.items.length)
        .map((g) => ({ key: `tier-${g.t}`, heading: <TierHeading tier={g.t} count={g.items.length} />, items: g.items }))
    : [...new Set(actions.map((i) => i.stage))].map((stage, si) => ({ key: stage, heading: <StageHeading n={si + 1} title={stage} />, items: actions.filter((i) => i.stage === stage) }));

  return (
    <div className="space-y-6">
      <ScenarioDetails def={def} answers={answers} onEdit={onEdit} className="no-print" />
      {checkedButNotApplicable.length > 0 && (
        <Alert tone="amber" title="Your answers changed what applies">
          {checkedButNotApplicable.length === 1 ? "A step you had checked off no longer applies" : `${checkedButNotApplicable.length} steps you had checked off no longer apply`} with your
          current answers: {checkedButNotApplicable.map((i) => i.title).join("; ")}. Nothing was erased — {checkedButNotApplicable.length === 1 ? "it is" : "they are"} listed
          under “not applicable” below, still checked.
        </Alert>
      )}

      {/* ── Summary: progress and what to do next ── */}
      <Card className="overflow-hidden">
        <div className={cn("relative overflow-hidden px-4 py-4 text-white sm:px-6", emergency ? "bg-gradient-to-br from-red-800 via-red-700 to-navy-800" : "bg-gradient-to-br from-navy-800 via-navy-800 to-brand-800")}>
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">{emergency ? "Emergency checklist — most urgent first" : "Your checklist"}</p>
              <p className="mt-1 text-lg font-medium leading-snug">{scenario?.determines ?? def.description}</p>
            </div>
            <div className="no-print flex flex-wrap gap-2">
              <HeroButton onClick={onEdit}>Edit answers</HeroButton>
              <HeroButton onClick={onStartOver}>Start over</HeroButton>
              <HeroButton onClick={() => { setAllOpen(true); window.print(); }}>Print</HeroButton>
            </div>
          </div>
        </div>
        <CardBody className="space-y-4 px-4 py-5 sm:px-6">
          <ProgressHeader progress={progress} />
          <NextActionPanel next={{ ...next, primary: next.primary.map(toNext), alsoUrgent: next.alsoUrgent.map(toNext), blocked: [] }} now={now} emergency={emergency} />
          {restrictions.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-red-800">
              <IconBan className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>
                {restrictions.length === 1 ? "A restriction is" : `${restrictions.length} restrictions are`} in effect until the steps marked “Restriction” are complete.
                {restrictions.some((i) => i.blocksSafetySensitive) && " The driver must not perform safety-sensitive functions (including driving a CMV) until those steps are completed and verified."}
              </span>
            </p>
          )}
          {result.warnings.map((w) => <Alert key={w} tone="amber">{w}</Alert>)}
        </CardBody>
      </Card>

      {/* ── Actions ── */}
      {groups.map((g) => (
        <section key={g.key}>
          {g.heading}
          <ol className="space-y-3">
            {g.items.map((i) => {
              const p = tierOf.get(i.ruleId)!;
              const undetermined = i.classification === "UNABLE_TO_DETERMINE";
              return (
                <ActionRow
                  key={i.ruleId}
                  id={i.ruleId}
                  title={i.title}
                  summary={i.rule.purpose}
                  tier={p.tier}
                  checked={isDone(i)}
                  onToggle={() => toggle(i.ruleId)}
                  badges={
                    <>
                      {p.tier <= 3 && <TierBadge tier={p.tier} />}
                      {undetermined && <Badge tone="amber">{L.needsDecision}</Badge>}
                      <ContentReviewBadge rule={i.rule} />
                      {(i.dueAt || p.tier <= 3) && <DeadlineBadge rule={i.rule} dueAt={i.dueAt} now={now} done={isDone(i)} />}
                    </>
                  }
                  alwaysVisible={p.tier === 1 ? <RequiredActions rule={i.rule} /> : undefined}
                >
                  <RuleDetails rule={i.rule} classification={i.classification} reasons={i.reasons} dueAt={i.dueAt} basis={p.basis} hideActions={p.tier === 1} />
                </ActionRow>
              );
            })}
          </ol>
        </section>
      ))}

      {notApplicable.length > 0 && (
        <details className="group rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-card sm:px-5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-700">
            <span>{notApplicable.length} requirements reviewed and not applicable to your answers</span>
            <IconChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
          </summary>
          <ul className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm">
            {notApplicable.map((i) => (
              <li key={i.ruleId}>
                <p className="text-slate-700">{checks[i.ruleId] && <IconCheck className="mr-1 inline h-3.5 w-3.5 text-accent-600" aria-label="Checked off earlier" />}{i.title} <span className="text-xs text-slate-400">· {i.rule.sources.map((s) => s.citation).join("; ")}</span></p>
                <p className="text-xs text-slate-500">{i.reasons.join(" ")}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="no-print flex flex-wrap items-center justify-between gap-4 rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50 to-white px-4 py-4 sm:px-5">
        <p className="max-w-xl text-sm text-slate-600">
          Checkmarks are saved in this browser only and are not a compliance record. To assign steps, upload evidence and record verification and approval,
          save this as a tracked checklist (requires an account). Your answers carry over — you will not be asked them again.
        </p>
        <Link
          href={`/workflows/${KEY_TO_SLUG[def.key]}/start${scenario ? `?scenario=${scenario.n}` : ""}`}
          onClick={() => setPendingSave(window.localStorage, { workflowKey: def.key, scenario: scenario?.n ?? null, title: scenario?.title ?? def.title })}
        >
          <Button>Save as tracked checklist</Button>
        </Link>
      </div>

      <p className="text-xs text-slate-500">
        Rule catalog {result.catalogVersion}. This guide explains federal requirements and links to their official text. It does not guarantee compliance and is
        not legal advice. State requirements are flagged where they may apply but are not yet loaded.
      </p>
    </div>
  );
}

function HeroButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="min-h-9 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white backdrop-blur transition hover:border-white/40 hover:bg-white/20">
      {children}
    </button>
  );
}

/** Open every step (collapsed <details> content is not printed by browsers). */
function setAllOpen(open: boolean) {
  document.querySelectorAll<HTMLDetailsElement>("details[data-step]").forEach((d) => (d.open = open));
}
