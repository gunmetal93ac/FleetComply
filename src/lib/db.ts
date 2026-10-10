import "server-only";
import { PrismaClient } from "@prisma/client";
import { TenantRepository, type TenantDb } from "./tenant/repository";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

/** The only way application code should touch tenant-owned tables. */
export function repo(orgId: string): TenantRepository {
  return new TenantRepository(orgId, prisma as unknown as TenantDb);
}
