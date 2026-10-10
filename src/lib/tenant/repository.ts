/**
 * Tenant-scoped data access.
 *
 * Every read and write for tenant data goes through TenantRepository, which
 * injects `orgId` into every where-clause and every create. Updates use
 * `updateMany({ where: { id, orgId } })`, so a cross-tenant id updates zero
 * rows and raises NotFoundError — the caller never learns the record exists.
 *
 * The repository depends only on the small Delegate interface below, which
 * Prisma model delegates satisfy. Tests run it against an in-memory store.
 */

export type Where = Record<string, unknown>;

export interface Delegate<T> {
  findFirst(args: { where: Where; include?: unknown }): Promise<T | null>;
  findMany(args: { where: Where; orderBy?: unknown; include?: unknown; take?: number }): Promise<T[]>;
  create(args: { data: Record<string, unknown> }): Promise<T>;
  updateMany(args: { where: Where; data: Record<string, unknown> }): Promise<{ count: number }>;
}

export type TenantModel = "driver" | "workflowRun" | "checklistItem" | "itemEvent" | "document" | "auditLog";
export type TenantDb = Record<TenantModel, Delegate<any>>;

export class NotFoundError extends Error {
  constructor(model: string) {
    super(`${model} not found`);
  }
}

export class TenantRepository {
  constructor(
    public readonly orgId: string,
    private readonly db: TenantDb,
  ) {
    if (!orgId) throw new Error("TenantRepository requires an orgId");
  }

  private scope(where: Where = {}): Where {
    // orgId is applied last so callers cannot override it.
    return { ...where, orgId: this.orgId };
  }

  async find<T = any>(model: TenantModel, id: string, include?: unknown): Promise<T> {
    const row = await this.db[model].findFirst({ where: this.scope({ id }), include });
    if (!row) throw new NotFoundError(model);
    return row as T;
  }

  async findMaybe<T = any>(model: TenantModel, where: Where, include?: unknown): Promise<T | null> {
    return (await this.db[model].findFirst({ where: this.scope(where), include })) as T | null;
  }

  async list<T = any>(model: TenantModel, where: Where = {}, opts: { orderBy?: unknown; include?: unknown; take?: number } = {}): Promise<T[]> {
    return (await this.db[model].findMany({ where: this.scope(where), ...opts })) as T[];
  }

  async create<T = any>(model: TenantModel, data: Record<string, unknown>): Promise<T> {
    return (await this.db[model].create({ data: { ...data, orgId: this.orgId } })) as T;
  }

  async update<T = any>(model: TenantModel, id: string, data: Record<string, unknown>): Promise<T> {
    const { orgId: _ignored, id: _id, ...safe } = data;
    const res = await this.db[model].updateMany({ where: this.scope({ id }), data: safe });
    if (res.count !== 1) throw new NotFoundError(model);
    return this.find<T>(model, id);
  }
}

/** Minimal in-memory TenantDb for tests and the no-database demo adapter. Equality matching only. */
export function createMemoryDb(): TenantDb & { _rows: Record<TenantModel, any[]> } {
  const rows: Record<TenantModel, any[]> = {
    driver: [], workflowRun: [], checklistItem: [], itemEvent: [], document: [], auditLog: [],
  };
  let seq = 0;
  const match = (r: any, where: Where) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && "in" in (v as any) ? (v as any).in.includes(r[k]) : r[k] === v,
    );
  const delegate = (m: TenantModel): Delegate<any> => ({
    async findFirst({ where }) {
      return rows[m].find((r) => match(r, where)) ?? null;
    },
    async findMany({ where, take }) {
      const out = rows[m].filter((r) => match(r, where));
      return take ? out.slice(0, take) : out;
    },
    async create({ data }) {
      const row = { id: `${m}_${++seq}`, createdAt: new Date(), ...data };
      rows[m].push(row);
      return row;
    },
    async updateMany({ where, data }) {
      const hits = rows[m].filter((r) => match(r, where));
      hits.forEach((r) => Object.assign(r, data));
      return { count: hits.length };
    },
  });
  return {
    _rows: rows,
    driver: delegate("driver"),
    workflowRun: delegate("workflowRun"),
    checklistItem: delegate("checklistItem"),
    itemEvent: delegate("itemEvent"),
    document: delegate("document"),
    auditLog: delegate("auditLog"),
  };
}
