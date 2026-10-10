import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/session";
import { repo } from "@/lib/db";
import { can } from "@/lib/auth/rbac";
import { storageFromEnv } from "@/lib/storage/adapter";
import { sha256 } from "@/lib/storage/crypto";
import type { RecordCategory, RegulatoryRule } from "@/lib/rules/types";

const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff", "doc", "docx", "txt"]);
const CATEGORIES: RecordCategory[] = [
  "DRIVER_QUALIFICATION_FILE", "DRIVER_INVESTIGATION_HISTORY_FILE", "DRUG_ALCOHOL_PROGRAM",
  "HAZMAT_TRAINING", "ACCIDENT_RECORDS", "GENERAL_EMPLOYMENT", "COMPANY_RECORDS",
];

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.role, "document:upload")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
  const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 15) * 1024 * 1024;
  if (file.size > maxBytes) return NextResponse.json({ error: `File is larger than ${process.env.MAX_UPLOAD_MB ?? 15} MB` }, { status: 413 });
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: "File type not allowed" }, { status: 415 });

  const r = repo(user.orgId);
  const itemId = String(form.get("itemId") ?? "") || null;
  let driverId = String(form.get("driverId") ?? "") || null;
  let runId: string | null = null;
  let recordCategory = String(form.get("recordCategory") ?? "") as RecordCategory;

  try {
    if (itemId) {
      const item = await r.find("checklistItem", itemId);
      const run = await r.find("workflowRun", item.runId);
      if (run.status !== "ACTIVE") return NextResponse.json({ error: "Workflow is approved; reopen it to add evidence" }, { status: 409 });
      runId = run.id;
      driverId = run.driverId;
      recordCategory = (item.ruleSnapshot as RegulatoryRule).recordCategory; // auto-associate with the requirement's record type
    } else if (driverId) {
      await r.find("driver", driverId);
      if (!CATEGORIES.includes(recordCategory)) return NextResponse.json({ error: "Choose a record category" }, { status: 400 });
    } else {
      return NextResponse.json({ error: "Attach the file to a checklist item or a driver" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const storageKey = `${user.orgId}/${randomBytes(16).toString("hex")}`;
  await storageFromEnv().put(storageKey, buf, file.type || "application/octet-stream");

  const prev = itemId ? (await r.list("document", { itemId, filename: file.name, deletedAt: null }, { orderBy: { version: "desc" }, take: 1 }))[0] : null;
  const expiresOnRaw = String(form.get("expiresOn") ?? "");
  const doc = await r.create("document", {
    driverId, runId, itemId, recordCategory,
    filename: file.name.slice(0, 200),
    contentType: file.type || "application/octet-stream",
    size: buf.length,
    sha256: sha256(buf),
    storageKey,
    version: prev ? prev.version + 1 : 1,
    supersedesId: prev?.id ?? null,
    expiresOn: expiresOnRaw ? new Date(expiresOnRaw) : null,
    uploadedById: user.id,
  });
  if (itemId) await r.create("itemEvent", { itemId, actorId: user.id, kind: "DOCUMENT", note: `Uploaded ${doc.filename} (v${doc.version})`, data: { documentId: doc.id } });
  await r.create("auditLog", { actorId: user.id, action: "document.upload", entityType: "Document", entityId: doc.id, meta: { sha256: doc.sha256, size: doc.size } });
  return NextResponse.json({ id: doc.id });
}
