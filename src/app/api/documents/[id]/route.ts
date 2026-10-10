import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { repo } from "@/lib/db";
import { can, SENSITIVE_CATEGORIES } from "@/lib/auth/rbac";
import { storageFromEnv } from "@/lib/storage/adapter";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.role, "document:read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const r = repo(user.orgId);
  const doc = await r.findMaybe("document", { id, deletedAt: null });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (SENSITIVE_CATEGORIES.has(doc.recordCategory) && !can(user.role, "document:read_sensitive")) {
    await r.create("auditLog", { actorId: user.id, action: "document.download_denied", entityType: "Document", entityId: id });
    return NextResponse.json({ error: "This record is restricted to safety and compliance roles" }, { status: 403 });
  }
  const data = await storageFromEnv().get(doc.storageKey);
  await r.create("auditLog", {
    actorId: user.id, action: "document.download", entityType: "Document", entityId: id,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
