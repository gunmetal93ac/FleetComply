import { TopBar } from "@/components/app/TopBar";
import { logoutAction } from "@/app/actions/auth";
import { requireUser } from "@/lib/auth/session";

/** Signed-in area: saved checklists, settings, and the (hidden) fleet-management pages. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <TopBar user={{ name: user.name, orgName: user.org.name, isSample: user.org.isSample, platformAdmin: user.platformAdmin }} logout={logoutAction} />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
