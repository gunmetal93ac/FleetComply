import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthShell title="Set up your company" footer={<>Already have an account? <Link className="font-medium text-brand-700" href="/login">Sign in</Link></>}>
      <RegisterForm />
    </AuthShell>
  );
}
