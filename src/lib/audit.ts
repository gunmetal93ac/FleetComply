import "server-only";
import type { TenantRepository } from "./tenant/repository";

export async function audit(
  r: TenantRepository,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId?: string | null,
  meta?: Record<string, unknown>,
) {
  await r.create("auditLog", { actorId, action, entityType, entityId: entityId ?? null, meta: meta ?? undefined });
}
