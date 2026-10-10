import Link from "next/link";
import { ScenarioSearch, StatusPill } from "@/components/guide/ScenarioSearch";
import { ResumeSaveBanner } from "@/components/guide/ResumeSaveBanner";
import { CATEGORY_THEME, CategoryIcon } from "@/components/guide/category-theme";
import { IconArrowRight, IconBook, IconShieldCheck, IconStar, IconZap } from "@/components/icons";
import { FEATURED, GUIDE_CATEGORIES, VISIBLE_SCENARIOS as SCENARIOS, getScenario, guideCategory, type Scenario } from "@/lib/workflows/scenarios";
import { scenarioHref } from "@/lib/workflows/slugs";
import { cn } from "@/components/ui";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const live = SCENARIOS.filter((s) => s.status === "LIVE").length;

  return (
    <div className="pb-16">
      <ResumeSaveBanner />
      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-brand-800">
        {/* soft light + grid texture for depth */}
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-brand-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-[-10%] h-72 w-96 rounded-full bg-accent-500/15 blur-3xl" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        />
        <div className="relative mx-auto max-w-3xl px-4 pb-14 pt-14 text-center sm:pb-20 sm:pt-20">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-navy-50 backdrop-blur">
            <IconShieldCheck className="h-3.5 w-3.5 text-accent-500" />
            Federal motor carrier compliance, step by step
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">What Do You Need Help With?</h1>
          <p className="mx-auto mb-9 mt-4 max-w-xl text-base text-navy-100 sm:text-lg">
            Describe what happened or what you’re trying to do. FleetComply finds the matching compliance workflow and walks you through every required step, with the regulation behind it.
          </p>
          <ScenarioSearch initialQuery={q} />
        </div>
      </section>

      {/* ── Trust strip ── */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 text-sm sm:grid-cols-3">
          <Trust icon={<IconBook className="h-4 w-4" />} tone="bg-brand-50 text-brand-700">Every legal step cites its regulation, linked to eCFR</Trust>
          <Trust icon={<IconZap className="h-4 w-4" />} tone="bg-highlight-50 text-highlight-700">Live deadline countdowns for time-critical steps</Trust>
          <Trust icon={<IconShieldCheck className="h-4 w-4" />} tone="bg-accent-50 text-accent-700">Unverified items are flagged — never guessed</Trust>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4">
        {/* ── Featured ── */}
        <section id="scenarios" className="scroll-mt-20 pt-12">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-navy-800">Common Compliance Scenarios</h2>
              <p className="mt-1 text-sm text-slate-500">
                {live} scenarios have full step-by-step guides. The other {SCENARIOS.length - live} are listed so you can see what’s covered next.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURED.map((f) => (
              <FeaturedCard key={f.n} scenario={getScenario(f.n)!} label={f.label} />
            ))}
          </div>
        </section>

        {/* ── By category ── */}
        <div className="mt-14 space-y-12">
          {GUIDE_CATEGORIES.map((cat) => {
            const items = SCENARIOS.filter((s) => guideCategory(s) === cat).sort((a, b) => Number(b.status === "LIVE") - Number(a.status === "LIVE") || a.n - b.n);
            const t = CATEGORY_THEME[cat];
            const liveCount = items.filter((s) => s.status === "LIVE").length;
            return (
              <section key={cat} aria-labelledby={`cat-${t.short}`}>
                <div className="mb-4 flex items-center gap-3">
                  <CategoryIcon category={cat} />
                  <div>
                    <h3 id={`cat-${t.short}`} className="text-lg font-semibold text-navy-800">{cat}</h3>
                    <p className="text-xs text-slate-500">
                      {items.length} scenarios{liveCount > 0 ? ` · ${liveCount} with step-by-step guides` : " · in development"}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((s) => <ScenarioCard key={s.n} scenario={s} />)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Trust({ icon, tone, children }: { icon: React.ReactNode; tone: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-slate-600">
      <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone)}>{icon}</span>
      {children}
    </p>
  );
}

function FeaturedCard({ scenario: s, label }: { scenario: Scenario; label: string }) {
  const live = s.status === "LIVE";
  const cat = guideCategory(s);
  return (
    <Link
      href={scenarioHref(s)}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-white p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        live ? cn("border-slate-200", CATEGORY_THEME[cat].hover) : "border-dashed border-slate-300",
      )}
    >
      {live && <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-highlight-400 to-highlight-500" />}
      <div className="flex items-start justify-between gap-3">
        <CategoryIcon category={cat} size="lg" muted={!live} />
        {live && (
          <span className="inline-flex items-center gap-1 rounded-full bg-highlight-50 px-2 py-0.5 text-[11px] font-semibold text-highlight-700 ring-1 ring-inset ring-highlight-100">
            <IconStar className="h-3 w-3 fill-current" /> Featured
          </span>
        )}
      </div>
      <p className={cn("mt-4 text-lg font-semibold", live ? "text-navy-800" : "text-slate-500")}>{label}</p>
      <p className="mt-1 flex-1 text-sm text-slate-500">{s.determines}</p>
      <div className="mt-4 flex items-center justify-between">
        <StatusPill live={live} />
        <span className={cn("inline-flex items-center gap-1 text-sm font-medium transition", live ? "text-brand-700" : "text-slate-400")}>
          {live ? "Start" : "View"}
          <IconArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  );
}

function ScenarioCard({ scenario: s }: { scenario: Scenario }) {
  const live = s.status === "LIVE";
  const cat = guideCategory(s);
  return (
    <Link
      href={scenarioHref(s)}
      className={cn(
        "group flex h-full items-start gap-3 rounded-xl border p-4 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        live
          ? cn("border-slate-200 bg-white shadow-card hover:-translate-y-0.5 hover:shadow-lift", CATEGORY_THEME[cat].hover)
          : "border-dashed border-slate-200 bg-white/50 hover:border-slate-300 hover:bg-white",
      )}
    >
      <CategoryIcon category={cat} size="sm" muted={!live} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold leading-snug", live ? "text-navy-800 group-hover:text-brand-700" : "text-slate-500")}>{s.title}</p>
        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{s.determines}</p>
        <p className={cn("mt-2 text-[11px] font-medium", live ? "text-accent-700" : "text-slate-400")}>{live ? "Step-by-step guide" : "Not yet developed"}</p>
      </div>
      <IconArrowRight className={cn("mt-0.5 h-4 w-4 shrink-0 transition group-hover:translate-x-0.5", live ? "text-slate-300 group-hover:text-brand-600" : "text-slate-200")} />
    </Link>
  );
}
