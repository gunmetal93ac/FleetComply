import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" footer={<>New company? <Link className="font-medium text-brand-700" href="/register">Create an account</Link></>}>
      <LoginForm />
    </AuthShell>
  );
}
