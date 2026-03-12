import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, or, sql, and, gte } from "drizzle-orm";
import {
  services,
  teams,
  serviceOwnership,
  serviceDependencies,
  deployments,
} from "./schema";

export interface ServiceNode {
  id: string;
  name: string;
  tier: number | null;
  language: string | null;
  repoUrl: string | null;
}

export interface DependencyEdge {
  fromServiceId: string;
  toServiceId: string;
  dependencyType: string | null;
}

export interface ServiceOwnerInfo {
  serviceId: string;
  serviceName: string;
  teamId: string;
  teamName: string;
  slackChannel: string | null;
  oncallRotation: string | null;
}

export interface DeploymentRecord {
  id: string;
  serviceId: string | null;
  version: string | null;
  commitSha: string | null;
  deployedAt: Date | null;
  deployer: string | null;
}

export interface TransitiveDep {
  fromServiceId: string;
  toServiceId: string;
  depth: number;
}

export function createDb(databaseUrl?: string) {
  const url =
    databaseUrl ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/oncall_agent";
  const client = postgres(url);
  return { db: drizzle(client), client };
}

/** Returns immediate upstream and downstream services for a given service id. */
export async function getDirectDependencies(
  serviceId: string,
  databaseUrl?: string
): Promise<{ upstream: ServiceNode[]; downstream: ServiceNode[] }> {
  const { db, client } = createDb(databaseUrl);

  try {
    // Downstream: services that serviceId calls
    const downstreamEdges = await db
      .select({ toServiceId: serviceDependencies.toServiceId })
      .from(serviceDependencies)
      .where(eq(serviceDependencies.fromServiceId, serviceId));

    // Upstream: services that call serviceId
    const upstreamEdges = await db
      .select({ fromServiceId: serviceDependencies.fromServiceId })
      .from(serviceDependencies)
      .where(eq(serviceDependencies.toServiceId, serviceId));

    const downstreamIds = downstreamEdges.map((e) => e.toServiceId).filter(Boolean) as string[];
    const upstreamIds = upstreamEdges.map((e) => e.fromServiceId).filter(Boolean) as string[];

    const [downstreamServices, upstreamServices] = await Promise.all([
      downstreamIds.length
        ? db.select().from(services).where(
            sql`${services.id} = ANY(${sql.raw(`ARRAY['${downstreamIds.join("','")}']::uuid[]`)})`
          )
        : Promise.resolve([]),
      upstreamIds.length
        ? db.select().from(services).where(
            sql`${services.id} = ANY(${sql.raw(`ARRAY['${upstreamIds.join("','")}']::uuid[]`)})`
          )
        : Promise.resolve([]),
    ]);

    return { upstream: upstreamServices, downstream: downstreamServices };
  } finally {
    await client.end();
  }
}

/** Walks the dependency graph up to `depth` levels using a recursive CTE. */
export async function getTransitiveDependencies(
  serviceId: string,
  depth: number,
  databaseUrl?: string
): Promise<TransitiveDep[]> {
  const { db, client } = createDb(databaseUrl);

  try {
    const result = await db.execute(sql`
      WITH RECURSIVE deps AS (
        SELECT from_service_id, to_service_id, 1 AS depth
        FROM service_dependencies
        WHERE from_service_id = ${serviceId}::uuid
        UNION ALL
        SELECT d.from_service_id, sd.to_service_id, d.depth + 1
        FROM deps d
        JOIN service_dependencies sd ON sd.from_service_id = d.to_service_id
        WHERE d.depth < ${depth}
      )
      SELECT DISTINCT from_service_id AS "fromServiceId",
                      to_service_id   AS "toServiceId",
                      depth
      FROM deps
      ORDER BY depth, from_service_id
    `);

    return (result as unknown as TransitiveDep[]);
  } finally {
    await client.end();
  }
}

/** Returns team ownership info (name, Slack channel, on-call rotation) for a service. */
export async function getServiceOwner(
  serviceId: string,
  databaseUrl?: string
): Promise<ServiceOwnerInfo | null> {
  const { db, client } = createDb(databaseUrl);

  try {
    const rows = await db
      .select({
        serviceId: services.id,
        serviceName: services.name,
        teamId: teams.id,
        teamName: teams.name,
        slackChannel: teams.slackChannel,
        oncallRotation: teams.oncallRotation,
      })
      .from(services)
      .innerJoin(serviceOwnership, eq(serviceOwnership.serviceId, services.id))
      .innerJoin(teams, eq(teams.id, serviceOwnership.teamId))
      .where(eq(services.id, serviceId));

    return rows[0] ?? null;
  } finally {
    await client.end();
  }
}

/** Returns all services that would be impacted if `serviceId` goes down (reverse transitive walk). */
export async function findImpactRadius(
  serviceId: string,
  databaseUrl?: string
): Promise<ServiceNode[]> {
  const { db, client } = createDb(databaseUrl);

  try {
    const result = await db.execute(sql`
      WITH RECURSIVE impact AS (
        SELECT from_service_id AS affected_id, 1 AS depth
        FROM service_dependencies
        WHERE to_service_id = ${serviceId}::uuid
        UNION ALL
        SELECT sd.from_service_id, i.depth + 1
        FROM impact i
        JOIN service_dependencies sd ON sd.to_service_id = i.affected_id
        WHERE i.depth < 10
      )
      SELECT DISTINCT s.id, s.name, s.tier, s.language, s.repo_url AS "repoUrl"
      FROM impact i
      JOIN services s ON s.id = i.affected_id
      ORDER BY s.name
    `);

    return (result as unknown as { id: string; name: string; tier: number | null; language: string | null; repoUrl: string | null }[]).map((r) => ({
      id: r.id,
      name: r.name,
      tier: r.tier ?? null,
      language: r.language ?? null,
      repoUrl: r.repoUrl ?? null,
    }));
  } finally {
    await client.end();
  }
}

/** Returns deployments for a service within the last `hours` hours. */
export async function getRecentDeployments(
  serviceId: string,
  hours: number,
  databaseUrl?: string
): Promise<DeploymentRecord[]> {
  const { db, client } = createDb(databaseUrl);

  try {
    const since = new Date(Date.now() - hours * 3600_000);
    const rows = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.serviceId, serviceId),
          gte(deployments.deployedAt, since)
        )
      );

    return rows;
  } finally {
    await client.end();
  }
}
