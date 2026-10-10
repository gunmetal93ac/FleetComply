import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { MfaForm } from "@/components/auth/MfaForm";
import { getPendingMfaSession } from "@/lib/auth/session";

export default async function MfaPage() {
  if (!(await getPendingMfaSession())) redirect("/login");
  return (
    <AuthShell title="Two-step verification">
      <MfaForm />
    </AuthShell>
  );
}
