import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type {
  StoredInvestigation,
  SimilarIncident,
  RecurrencePattern,
  CalibrationStats,
  StoreOptions,
} from "./types";
import { embedInvestigation, embedQuery } from "./embeddings";

// ── DB connection ─────────────────────────────────────────────────────────

function createDb(databaseUrl?: string) {
  const url =
    databaseUrl ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/oncall_agent";
  const client = postgres(url);
  return { db: drizzle(client), client };
}

// ── Store: persist investigations ─────────────────────────────────────────

export async function storeInvestigation(
  investigation: Omit<StoredInvestigation, "id" | "investigatedAt">,
  opts: StoreOptions = {}
): Promise<string> {
  const { db, client } = createDb(opts.databaseUrl);

  try {
    // Generate embedding if not provided
    const embedding =
      investigation.embedding ??
      (await embedInvestigation(investigation));

    const vectorStr = `[${embedding.join(",")}]`;

    const result = await db.execute(sql`
      INSERT INTO investigation_memory (
        alert_id, alert_title, service, severity, scenario,
        root_cause, resolution, summary,
        hypotheses, evidence,
        top_confidence, escalated, validator_notes,
        feedback, correction_text, feedback_user,
        embedding, investigated_at, feedback_at
      ) VALUES (
        ${investigation.alertId},
        ${investigation.alertTitle},
        ${investigation.service},
        ${investigation.severity},
        ${investigation.scenario ?? null},
        ${investigation.rootCause ?? null},
        ${investigation.resolution ?? null},
        ${investigation.summary ?? null},
        ${JSON.stringify(investigation.hypotheses)}::jsonb,
        ${JSON.stringify(investigation.evidence)}::jsonb,
        ${investigation.topConfidence ?? null},
        ${investigation.escalated},
        ${investigation.validatorNotes ?? null},
        ${investigation.feedback ?? null},
        ${investigation.correctionText ?? null},
        ${investigation.feedbackUser ?? null},
        ${vectorStr}::vector,
        now(),
        ${investigation.feedbackAt ?? null}
      )
      RETURNING id
    `);

    const row = (result as unknown as { id: string }[])[0];
    return row!.id;
  } finally {
    await client.end();
  }
}

// ── Store: update feedback ────────────────────────────────────────────────

export async function updateFeedback(
  investigationId: string,
  feedback: "confirmed" | "rejected" | "corrected",
  userId: string,
  correctionText?: string,
  opts: StoreOptions = {}
): Promise<void> {
  const { db, client } = createDb(opts.databaseUrl);

  try {
    await db.execute(sql`
      UPDATE investigation_memory
      SET
        feedback = ${feedback},
        feedback_user = ${userId},
        correction_text = ${correctionText ?? null},
        feedback_at = now()
      WHERE id = ${investigationId}::uuid
    `);
  } finally {
    await client.end();
  }
}

// ── Search: semantic similarity ───────────────────────────────────────────

export async function searchSimilar(
  query: string,
  opts: StoreOptions & {
    service?: string;
    limit?: number;
    minSimilarity?: number;
    embedFn?: (text: string) => Promise<number[]>;
  } = {}
): Promise<SimilarIncident[]> {
  const { db, client } = createDb(opts.databaseUrl);
  const limit = opts.limit ?? 5;
  const minSimilarity = opts.minSimilarity ?? 0.3;

  try {
    const queryEmbedding = await embedQuery(query, opts.embedFn);
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    // Combine vector similarity with optional service filter
    const serviceFilter = opts.service
      ? sql`AND service = ${opts.service}`
      : sql``;

    const results = await db.execute(sql`
      SELECT
        id,
        alert_title AS "alertTitle",
        service,
        severity,
        root_cause AS "rootCause",
        resolution,
        summary,
        feedback,
        correction_text AS "correctionText",
        top_confidence AS "topConfidence",
        investigated_at AS "investigatedAt",
        1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM investigation_memory
      WHERE embedding IS NOT NULL
        ${serviceFilter}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return (results as unknown as SimilarIncident[]).filter(
      (r) => r.similarity >= minSimilarity
    );
  } finally {
    await client.end();
  }
}

// ── Search: full-text ─────────────────────────────────────────────────────

export async function searchByText(
  query: string,
  opts: StoreOptions & { service?: string; limit?: number } = {}
): Promise<SimilarIncident[]> {
  const { db, client } = createDb(opts.databaseUrl);
  const limit = opts.limit ?? 5;

  try {
    const serviceFilter = opts.service
      ? sql`AND service = ${opts.service}`
      : sql``;

    const results = await db.execute(sql`
      SELECT
        id,
        alert_title AS "alertTitle",
        service,
        severity,
        root_cause AS "rootCause",
        resolution,
        summary,
        feedback,
        correction_text AS "correctionText",
        top_confidence AS "topConfidence",
        investigated_at AS "investigatedAt",
        ts_rank(to_tsvector('english', search_text), plainto_tsquery('english', ${query})) AS similarity
      FROM investigation_memory
      WHERE to_tsvector('english', search_text) @@ plainto_tsquery('english', ${query})
        ${serviceFilter}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    return results as unknown as SimilarIncident[];
  } finally {
    await client.end();
  }
}

// ── Search: hybrid (vector + full-text) ───────────────────────────────────

export async function searchHybrid(
  query: string,
  opts: StoreOptions & {
    service?: string;
    limit?: number;
    minSimilarity?: number;
    embedFn?: (text: string) => Promise<number[]>;
  } = {}
): Promise<SimilarIncident[]> {
  const { db, client } = createDb(opts.databaseUrl);
  const limit = opts.limit ?? 5;
  const minSimilarity = opts.minSimilarity ?? 0.2;

  try {
    const queryEmbedding = await embedQuery(query, opts.embedFn);
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    const serviceFilter = opts.service
      ? sql`AND service = ${opts.service}`
      : sql``;

    // Combine vector similarity (0.7 weight) with text rank (0.3 weight)
    const results = await db.execute(sql`
      SELECT
        id,
        alert_title AS "alertTitle",
        service,
        severity,
        root_cause AS "rootCause",
        resolution,
        summary,
        feedback,
        correction_text AS "correctionText",
        top_confidence AS "topConfidence",
        investigated_at AS "investigatedAt",
        (
          0.7 * (1 - (embedding <=> ${vectorStr}::vector)) +
          0.3 * COALESCE(ts_rank(to_tsvector('english', search_text), plainto_tsquery('english', ${query})), 0)
        ) AS similarity
      FROM investigation_memory
      WHERE embedding IS NOT NULL
        ${serviceFilter}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    return (results as unknown as SimilarIncident[]).filter(
      (r) => r.similarity >= minSimilarity
    );
  } finally {
    await client.end();
  }
}

// ── Pattern detection: recurrence ─────────────────────────────────────────

export async function detectRecurrence(
  service: string,
  windowDays: number = 14,
  minCount: number = 3,
  opts: StoreOptions = {}
): Promise<RecurrencePattern | null> {
  const { db, client } = createDb(opts.databaseUrl);

  try {
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const results = await db.execute(sql`
      SELECT
        id,
        alert_title AS "alertTitle",
        root_cause AS "rootCause",
        investigated_at AS "investigatedAt"
      FROM investigation_memory
      WHERE service = ${service}
        AND investigated_at >= ${since}
      ORDER BY investigated_at DESC
    `);

    const incidents = results as unknown as Array<{
      id: string;
      alertTitle: string;
      rootCause: string | null;
      investigatedAt: Date;
    }>;

    if (incidents.length < minCount) return null;

    // Extract common root causes
    const rootCauseCounts = new Map<string, number>();
    for (const inc of incidents) {
      if (inc.rootCause) {
        const key = inc.rootCause.toLowerCase().trim();
        rootCauseCounts.set(key, (rootCauseCounts.get(key) ?? 0) + 1);
      }
    }

    const commonRootCauses = [...rootCauseCounts.entries()]
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([cause]) => cause);

    return {
      service,
      count: incidents.length,
      incidents: incidents.map((i) => ({
        id: i.id,
        alertTitle: i.alertTitle,
        rootCause: i.rootCause ?? undefined,
        investigatedAt: i.investigatedAt,
      })),
      commonRootCauses,
    };
  } finally {
    await client.end();
  }
}

// ── Calibration: historical accuracy ──────────────────────────────────────

export async function getCalibrationStats(
  service?: string,
  opts: StoreOptions = {}
): Promise<CalibrationStats[]> {
  const { db, client } = createDb(opts.databaseUrl);

  try {
    const serviceFilter = service
      ? sql`WHERE service = ${service}`
      : sql``;

    const results = await db.execute(sql`
      SELECT
        service,
        COUNT(*)::int AS "totalInvestigations",
        COUNT(*) FILTER (WHERE feedback = 'confirmed')::int AS "confirmedCount",
        COUNT(*) FILTER (WHERE feedback = 'rejected')::int AS "rejectedCount",
        COUNT(*) FILTER (WHERE feedback = 'corrected')::int AS "correctedCount",
        COALESCE(AVG(top_confidence), 0)::int AS "averageConfidence",
        CASE
          WHEN COUNT(*) FILTER (WHERE feedback IS NOT NULL) = 0 THEN 0
          ELSE ROUND(
            COUNT(*) FILTER (WHERE feedback = 'confirmed')::numeric /
            NULLIF(COUNT(*) FILTER (WHERE feedback IS NOT NULL), 0) * 100
          )::int
        END AS "accuracyRate"
      FROM investigation_memory
      ${serviceFilter}
      GROUP BY service
      ORDER BY "totalInvestigations" DESC
    `);

    return results as unknown as CalibrationStats[];
  } finally {
    await client.end();
  }
}

// ── Convenience: get recent investigations ────────────────────────────────

export async function getRecentInvestigations(
  opts: StoreOptions & { service?: string; limit?: number } = {}
): Promise<StoredInvestigation[]> {
  const { db, client } = createDb(opts.databaseUrl);
  const limit = opts.limit ?? 10;

  try {
    const serviceFilter = opts.service
      ? sql`WHERE service = ${opts.service}`
      : sql``;

    const results = await db.execute(sql`
      SELECT
        id,
        alert_id AS "alertId",
        alert_title AS "alertTitle",
        service,
        severity,
        scenario,
        root_cause AS "rootCause",
        resolution,
        summary,
        hypotheses,
        evidence,
        top_confidence AS "topConfidence",
        escalated,
        validator_notes AS "validatorNotes",
        feedback,
        correction_text AS "correctionText",
        feedback_user AS "feedbackUser",
        investigated_at AS "investigatedAt",
        feedback_at AS "feedbackAt"
      FROM investigation_memory
      ${serviceFilter}
      ORDER BY investigated_at DESC
      LIMIT ${limit}
    `);

    return results as unknown as StoredInvestigation[];
  } finally {
    await client.end();
  }
}
