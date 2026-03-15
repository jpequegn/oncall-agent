import Anthropic from "@anthropic-ai/sdk";
import type { Alert } from "@shared/types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ParsedAlert extends Alert {
  rawText: string;
}

export interface ParseOptions {
  apiKey?: string;
  /** Inject a pre-configured client (used in tests). */
  client?: Anthropic;
  /** Platform source label (e.g. "slack", "teams"). Defaults to "bot". */
  source?: string;
}

// ── Severity mapping ───────────────────────────────────────────────────────

const SEVERITY_MAP: Record<string, Alert["severity"]> = {
  p1: "critical", critical: "critical",
  p2: "high",     high: "high",
  p3: "medium",   medium: "medium",
  p4: "low",      low: "low",
};

function normalizeSeverity(raw: string | undefined): Alert["severity"] {
  if (!raw) return "high"; // default P2 → high
  return SEVERITY_MAP[raw.toLowerCase()] ?? "high";
}

// ── Regex fallback ─────────────────────────────────────────────────────────

const SERVICE_PATTERN  = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*-service)\b/i;
const SEVERITY_PATTERN = /\b(P[1-4]|critical|high|medium|low)\b/i;
const TIME_PATTERN     = /\b(\d{1,2}:\d{2})\b|(\d+)\s+minutes?\s+ago/i;
const KV_PATTERN       = /service=([^\s]+)/i;
const KV_SEV_PATTERN   = /severity=(p[1-4]|critical|high|medium|low)/i;

function regexFallback(text: string): Partial<RawExtracted> {
  const kvService  = KV_PATTERN.exec(text);
  const kvSev      = KV_SEV_PATTERN.exec(text);
  const service    = kvService?.[1] ?? SERVICE_PATTERN.exec(text)?.[1];
  const severityRaw = kvSev?.[1] ?? SEVERITY_PATTERN.exec(text)?.[1];
  const timeMatch  = TIME_PATTERN.exec(text);

  let started_at: string | undefined;
  if (timeMatch?.[1]) {
    // HH:MM time — assume today
    const [h, m] = timeMatch[1].split(":").map(Number);
    const d = new Date();
    d.setHours(h!, m!, 0, 0);
    started_at = d.toISOString();
  } else if (timeMatch?.[2]) {
    started_at = new Date(Date.now() - Number(timeMatch[2]) * 60_000).toISOString();
  }

  return {
    service: service ?? undefined,
    severity: severityRaw ?? undefined,
    description: text.trim(),
    started_at,
  };
}

// ── LLM extraction ─────────────────────────────────────────────────────────

interface RawExtracted {
  service?: string;
  severity?: string;
  description?: string;
  started_at?: string;
}

const EXTRACTION_PROMPT = `Extract incident information from the following message.
Return ONLY a JSON object with these fields:
- service: string (the affected service name, e.g. "payment-service")
- severity: string (one of: P1, P2, P3, P4, critical, high, medium, low)
- description: string (brief incident description, max 200 chars)
- started_at: string (ISO 8601 if a time was mentioned, else null)

If a field is not present in the message, omit it or set it to null.
Return JSON only — no markdown, no extra text.`;

async function extractWithLLM(text: string, client: Anthropic): Promise<RawExtracted> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      { role: "user", content: `${EXTRACTION_PROMPT}\n\nMessage: "${text}"` },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text.trim() : "";
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  try {
    return JSON.parse(cleaned) as RawExtracted;
  } catch {
    return {};
  }
}

// ── Main parseAlert function ───────────────────────────────────────────────

export async function parseAlert(
  text: string,
  opts: ParseOptions = {}
): Promise<ParsedAlert> {
  const source = opts.source ?? "bot";

  // Strip @mention prefix (works for both Slack and Teams formats)
  const cleanText = text.replace(/^<@[^>]+>\s*/, "").trim();

  let extracted: RawExtracted = {};

  if (opts.client ?? process.env.ANTHROPIC_API_KEY) {
    try {
      const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      extracted = await extractWithLLM(cleanText, client);
    } catch {
      // fall through to regex
    }
  }

  // Merge with regex fallback for any missing fields
  const regex = regexFallback(cleanText);
  const service     = extracted.service     ?? regex.service     ?? "unknown-service";
  const severityRaw = extracted.severity    ?? regex.severity;
  const description = extracted.description ?? regex.description ?? cleanText;
  const startedAtRaw = extracted.started_at ?? regex.started_at;

  const startedAt = startedAtRaw ? new Date(startedAtRaw) : new Date();

  return {
    id: `${source}-${Date.now()}`,
    title: description.slice(0, 200),
    severity: normalizeSeverity(severityRaw),
    service,
    timestamp: startedAt,
    labels: { env: "production", source },
    description,
    rawText: text,
  };
}
