import { TopBar } from "@/components/app/TopBar";
import { logoutAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Public area: search, compliance guides, regulatory library. No account needed.
 * The session lookup only decides whether to show "Sign in" or the user's name;
 * if the database is unreachable the guide still works.
 *
 * Pages own their width (the home page hero is full-bleed); others use <PageContainer>.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  let user = null;
  try {
    const u = await getCurrentUser();
    if (u) user = { name: u.name, orgName: u.org.name, isSample: u.org.isSample, platformAdmin: u.platformAdmin };
  } catch {
    user = null;
  }
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar user={user} logout={logoutAction} />
      <main className="flex-1">{children}</main>
      <footer className="no-print border-t border-slate-200 bg-white">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs leading-relaxed text-slate-500">
          FleetComply explains federal transportation regulations and links to official sources (eCFR, FMCSA). It is not legal advice and does not guarantee
          compliance. Items marked “Requires Regulatory Verification” or “Unable to determine” need review by a qualified person.
        </p>
      </footer>
    </div>
  );
}
