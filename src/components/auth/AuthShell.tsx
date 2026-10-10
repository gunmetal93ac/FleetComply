import type { ReactNode } from "react";
import { Logo } from "@/components/app/TopBar";

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-navy-800 to-transparent opacity-[0.08]" />
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-80 w-[640px] -translate-x-1/2 rounded-full bg-brand-500/10 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <a href="/" className="inline-block text-navy-800">
            <Logo />
          </a>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-navy-800">{title}</h1>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-lift">{children}</div>
        {footer && <div className="mt-4 text-center text-sm text-slate-600">{footer}</div>}
        <p className="mt-3 text-center text-sm">
          <a href="/" className="font-medium text-brand-700 hover:underline">← Use the compliance guide without an account</a>
        </p>
      </div>
    </main>
  );
}
