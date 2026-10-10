export type Role = "OWNER" | "ADMIN" | "SAFETY_MANAGER" | "HR" | "DISPATCH" | "VIEWER";

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  SAFETY_MANAGER: "Safety / DOT compliance manager",
  HR: "Human resources",
  DISPATCH: "Dispatch / operations",
  VIEWER: "Read-only",
};

export type Permission =
  | "dashboard:read"
  | "driver:read"
  | "driver:write"
  | "run:create"
  | "run:approve"
  | "item:update"
  | "item:verify"
  | "document:upload"
  | "document:read"
  /** Drug & alcohol records and the driver investigation history file (391.53 / 382.401 access limits). */
  | "document:read_sensitive"
  | "org:manage"
  | "user:manage"
  | "audit:read";

const MATRIX: Record<Role, Permission[]> = {
  OWNER: [
    "dashboard:read", "driver:read", "driver:write", "run:create", "run:approve", "item:update", "item:verify",
    "document:upload", "document:read", "document:read_sensitive", "org:manage", "user:manage", "audit:read",
  ],
  ADMIN: [
    "dashboard:read", "driver:read", "driver:write", "run:create", "run:approve", "item:update", "item:verify",
    "document:upload", "document:read", "document:read_sensitive", "org:manage", "user:manage", "audit:read",
  ],
  SAFETY_MANAGER: [
    "dashboard:read", "driver:read", "driver:write", "run:create", "run:approve", "item:update", "item:verify",
    "document:upload", "document:read", "document:read_sensitive", "audit:read",
  ],
  HR: ["dashboard:read", "driver:read", "driver:write", "run:create", "item:update", "document:upload", "document:read"],
  DISPATCH: ["dashboard:read", "driver:read"],
  VIEWER: ["dashboard:read", "driver:read", "document:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

// ───────────────────────── Platform administrators ─────────────────────────

/**
 * Platform administration is NOT a customer role. Owner/Admin apply inside one company
 * (anyone who registers is Owner of their own); a platform administrator is a FleetComply
 * operator who may manage the shared compliance library. The flag is set only by
 * scripts/grant-platform-admin.ts.
 */
export class PlatformAdminRequiredError extends Error {
  constructor() {
    super("Platform administrator access required");
  }
}

export function isPlatformAdmin(user: { platformAdmin?: boolean; disabled?: boolean } | null | undefined): boolean {
  return !!user && user.platformAdmin === true && user.disabled !== true;
}

/** Throws unless the user is a platform administrator. Customer roles — including Owner — never satisfy it. */
export function assertPlatformAdmin(user: { platformAdmin?: boolean; disabled?: boolean } | null | undefined): void {
  if (!isPlatformAdmin(user)) throw new PlatformAdminRequiredError();
}

/** Record categories whose documents require document:read_sensitive. */
export const SENSITIVE_CATEGORIES = new Set(["DRUG_ALCOHOL_PROGRAM", "DRIVER_INVESTIGATION_HISTORY_FILE"]);
