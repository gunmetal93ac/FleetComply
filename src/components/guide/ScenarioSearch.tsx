"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchScenarios } from "@/lib/search/scenario-search";
import { guideCategory } from "@/lib/workflows/scenarios";
import { scenarioHref } from "@/lib/workflows/slugs";
import { cn } from "@/components/ui";
import { IconArrowRight, IconSearch } from "@/components/icons";
import { CategoryIcon } from "./category-theme";

const EXAMPLES = [
  "I'm hiring a new CDL driver",
  "One of my drivers was in an accident",
  "A driver tested positive on a drug test",
  "My driver was put out of service",
];

/** The home page search box (sits on the dark hero). Matches as you type; Enter / the button commits the query to the URL. */
export function ScenarioSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchScenarios(query), [query]);
  const showResults = query.trim().length >= 3 || submitted.trim().length > 0;

  useEffect(() => {
    if (!initialQuery) inputRef.current?.focus();
  }, [initialQuery]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(query);
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }

  function applyExample(ex: string) {
    setQuery(ex);
    setSubmitted(ex);
    inputRef.current?.focus();
  }

  return (
    <div>
      <form onSubmit={submit} role="search">
        <label htmlFor="scenario-search" className="sr-only">Describe your situation</label>
        <div className="group relative flex items-center rounded-2xl bg-white p-2 shadow-search ring-1 ring-white/20 transition focus-within:ring-4 focus-within:ring-brand-400/40">
          <IconSearch className="pointer-events-none ml-3 h-6 w-6 shrink-0 text-slate-400 transition group-focus-within:text-brand-600" />
          <input
            ref={inputRef}
            id="scenario-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe your situation... e.g., I'm hiring a new CDL driver"
            className="h-12 min-w-0 flex-1 bg-transparent px-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none sm:h-14 sm:text-lg"
          />
          <button
            type="submit"
            className="hidden h-12 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 px-5 text-sm font-semibold text-white shadow-md shadow-brand-700/30 transition hover:-translate-y-px hover:shadow-lg hover:shadow-brand-700/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 sm:inline-flex sm:h-14"
          >
            Search Compliance Scenarios
            <IconArrowRight className="h-4 w-4" />
          </button>
          <button type="submit" aria-label="Search Compliance Scenarios" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white sm:hidden">
            <IconArrowRight className="h-5 w-5" />
          </button>
        </div>
      </form>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => applyExample(ex)}
            className="rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-sm text-navy-50 backdrop-blur transition hover:-translate-y-px hover:border-white/30 hover:bg-white/20 hover:text-white"
          >
            {ex}
          </button>
        ))}
      </div>

      {showResults && (
        <section aria-live="polite" className="mt-6 text-left">
          {results.length > 0 ? (
            <div className="overflow-hidden rounded-2xl bg-white shadow-search ring-1 ring-black/5">
              <p className="border-b border-slate-100 px-5 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                {results.length} matching scenario{results.length === 1 ? "" : "s"} — choose the one that fits
              </p>
              <ul className="divide-y divide-slate-100">
                {results.map(({ scenario: s }, i) => {
                  const live = s.status === "LIVE";
                  return (
                    <li key={s.n}>
                      <Link href={scenarioHref(s)} className={cn("group flex items-center gap-4 px-5 py-4 transition hover:bg-brand-50/60", i === 0 && "bg-brand-50/30")}>
                        <CategoryIcon category={guideCategory(s)} muted={!live} />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-navy-800 group-hover:text-brand-700">{s.title}</p>
                          <p className="mt-0.5 truncate text-sm text-slate-500">{s.determines}</p>
                        </div>
                        <StatusPill live={live} />
                        <IconArrowRight className="hidden h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600 sm:block" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="rounded-2xl border-l-4 border-highlight-400 bg-white px-5 py-4 text-sm text-slate-700 shadow-search">
              <p className="font-semibold text-navy-800">No verified workflow found for “{query.trim() || submitted.trim()}”.</p>
              <p className="mt-1">
                FleetComply only shows guidance it can trace to a regulation, so it won’t guess. Try different words (for example “accident”, “drug test”,
                “hiring”), browse the scenarios below, or{" "}
                <Link className="font-medium text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-brand-700" href={`/library?q=${encodeURIComponent(query.trim())}`}>
                  search the regulatory library
                </Link>
                .
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function StatusPill({ live }: { live: boolean }) {
  return live ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 ring-1 ring-inset ring-accent-100">
      <span className="h-1.5 w-1.5 rounded-full bg-accent-500" /> Step-by-step guide
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" /> Not yet developed
    </span>
  );
}
