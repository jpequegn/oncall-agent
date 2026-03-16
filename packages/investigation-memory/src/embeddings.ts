import type { StoredInvestigation } from "./types";

// ── Embedding generation ──────────────────────────────────────────────────
// Uses a simple text-based approach that generates a deterministic "embedding"
// from the investigation text. In production, swap this for a real embedding
// API (Voyage AI, OpenAI, etc). The vector dimension must match the DB column (1024).

const EMBEDDING_DIM = 1024;

/**
 * Build a text representation of an investigation suitable for embedding.
 * Captures the key semantic content: service, symptoms, root cause, resolution.
 */
export function buildEmbeddingText(investigation: Omit<StoredInvestigation, "id" | "embedding" | "investigatedAt">): string {
  const parts: string[] = [];

  parts.push(`Service: ${investigation.service}`);
  parts.push(`Alert: ${investigation.alertTitle}`);
  parts.push(`Severity: ${investigation.severity}`);

  if (investigation.summary) {
    parts.push(`Summary: ${investigation.summary}`);
  }
  if (investigation.rootCause) {
    parts.push(`Root cause: ${investigation.rootCause}`);
  }
  if (investigation.resolution) {
    parts.push(`Resolution: ${investigation.resolution}`);
  }

  for (const h of investigation.hypotheses) {
    parts.push(`Hypothesis (${h.confidence}%): ${h.description}`);
    for (const e of h.evidence) {
      parts.push(`  Evidence: ${e}`);
    }
  }

  if (investigation.feedback === "corrected" && investigation.correctionText) {
    parts.push(`Human correction: ${investigation.correctionText}`);
  }

  return parts.join("\n");
}

/**
 * Generate a deterministic embedding vector from text using character-level hashing.
 * This is a lightweight local fallback — replace with a real embedding API for production.
 */
export function generateLocalEmbedding(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIM);

  // Simple but deterministic: hash sliding character windows into vector positions
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Mix character position and value across multiple vector dimensions
    const idx1 = (code * 31 + i * 7) % EMBEDDING_DIM;
    const idx2 = (code * 17 + i * 13) % EMBEDDING_DIM;
    const idx3 = (code * 43 + i * 3) % EMBEDDING_DIM;
    vec[idx1] += Math.sin(code * 0.1 + i * 0.01);
    vec[idx2] += Math.cos(code * 0.07 + i * 0.03);
    vec[idx3] += Math.sin(code * 0.13 + i * 0.02) * 0.5;
  }

  // L2 normalize so cosine similarity works correctly
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] /= norm;
    }
  }

  return Array.from(vec);
}

/**
 * Generate an embedding for an investigation.
 * Uses local hashing by default. Override `embedFn` for a real embedding API.
 */
export async function embedInvestigation(
  investigation: Omit<StoredInvestigation, "id" | "embedding" | "investigatedAt">,
  embedFn?: (text: string) => Promise<number[]>
): Promise<number[]> {
  const text = buildEmbeddingText(investigation);

  if (embedFn) {
    return embedFn(text);
  }

  return generateLocalEmbedding(text);
}

/**
 * Generate an embedding for a search query.
 */
export async function embedQuery(
  query: string,
  embedFn?: (text: string) => Promise<number[]>
): Promise<number[]> {
  if (embedFn) {
    return embedFn(query);
  }

  return generateLocalEmbedding(query);
}
