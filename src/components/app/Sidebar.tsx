"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/components/ui";

const NAV: Array<{ href: string; label: string; planned?: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/workflows", label: "Compliance Workflows" },
  { href: "/drivers", label: "Drivers" },
  { href: "/vehicles", label: "Vehicles", planned: "Phase 2" },
  { href: "/documents", label: "Documents" },
  { href: "/calendar", label: "Compliance Calendar", planned: "Phase 2" },
  { href: "/library", label: "Regulatory Library" },
  { href: "/assistant", label: "AI Assistant", planned: "Phase 3" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({ orgName, userName, isSample, logout }: { orgName: string; userName: string; isSample: boolean; logout: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <span className="font-bold text-brand-700">FleetComply</span>
        <button className="rounded-md border border-slate-300 px-3 py-1 text-sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="sidenav">
          Menu
        </button>
      </div>
      <aside
        id="sidenav"
        className={cn(
          "no-print fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-slate-200 bg-white lg:flex",
          open ? "flex" : "hidden",
        )}
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-lg font-bold tracking-tight text-brand-700">FleetComply</p>
          <p className="truncate text-xs text-slate-500" title={orgName}>{orgName}</p>
          {isSample && <p className="mt-1 inline-block rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800">SAMPLE COMPANY — FICTIONAL DATA</p>}
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
          {NAV.map((n) => {
            const active = path === n.href || path.startsWith(n.href + "/") || (n.href === "/workflows" && path.startsWith("/runs"));
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "mb-0.5 flex items-center justify-between rounded-md px-3 py-2 text-sm",
                  active ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-700 hover:bg-slate-100",
                )}
              >
                <span>{n.label}</span>
                {n.planned && <span className="text-[10px] font-medium uppercase text-slate-400">{n.planned}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 px-5 py-3 text-sm">
          <p className="truncate text-slate-700">{userName}</p>
          <form action={logout}>
            <button className="mt-1 text-xs font-medium text-slate-500 hover:text-slate-800">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}
