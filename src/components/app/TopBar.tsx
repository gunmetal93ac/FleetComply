import Link from "next/link";
import { navFor } from "@/lib/nav";
import { IconShieldCheck } from "@/components/icons";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-sm shadow-brand-900/30">
        <IconShieldCheck className="h-[18px] w-[18px]" />
      </span>
      <span className="text-lg font-bold tracking-tight">FleetComply</span>
    </span>
  );
}

/** Slim header used on every page. Replaces the old sidebar (kept in Sidebar.tsx, unused). */
export function TopBar({ user, logout }: { user: { name: string; orgName: string; isSample: boolean; platformAdmin?: boolean } | null; logout: () => Promise<void> }) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-navy-800/95 text-white backdrop-blur supports-[backdrop-filter]:bg-navy-800/85">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
        <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-wrap items-center gap-x-1 gap-y-1 text-sm" aria-label="Main">
          {navFor(!!user, user?.platformAdmin === true).map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-navy-100 transition hover:bg-white/10 hover:text-white">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="hidden max-w-[220px] truncate text-navy-300 sm:inline" title={`${user.name} · ${user.orgName}`}>
                {user.name}
                {user.isSample && <span className="ml-1.5 rounded bg-highlight-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-highlight-400">SAMPLE</span>}
              </span>
              <form action={logout}>
                <button className="rounded-md px-3 py-1.5 font-medium text-navy-100 transition hover:bg-white/10 hover:text-white">Sign out</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="rounded-lg border border-white/20 px-3.5 py-1.5 font-medium text-white transition hover:border-white/40 hover:bg-white/10">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
