/**
 * Re-export investigation-agent fixtures for use in pipeline tests.
 * Copied to avoid cross-package test import issues.
 */
type LooseMessage = Omit<import("@anthropic-ai/sdk/resources/messages/messages").Message, "content"> & {
  content: unknown[];
};

function usage() {
  return { input_tokens: 1200, output_tokens: 480, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

// ── Scenario A: Deploy regression ─────────────────────────────────────────

export const scenarioAResponses: LooseMessage[] = [
  {
    id: "msg_a1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "text", text: "I'll investigate the payment-service incident. Let me gather evidence in parallel." },
      { type: "tool_use", id: "tu_a1", name: "query_metrics",     input: { service: "payment-service" } },
      { type: "tool_use", id: "tu_a2", name: "get_recent_deploys", input: { service: "payment-service", hours: 4 } },
      { type: "tool_use", id: "tu_a3", name: "search_logs",        input: { service: "payment-service", level: "ERROR" } },
      { type: "tool_use", id: "tu_a4", name: "get_service_deps",   input: { service: "payment-service" } },
    ],
  },
  {
    id: "msg_a2",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 3800, output_tokens: 620, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    content: [
      {
        type: "text",
        text: JSON.stringify({
          hypotheses: [
            {
              rank: 1,
              description: "Deploy abc123 (v2.4.1) introduced a NullPointerException in PaymentProcessor.java:247 — ProviderFactory.getProvider() returns null when Stripe SCA config is missing",
              confidence: 87,
              supporting_evidence: [
                "Deploy abc123 at 14:28 touched PaymentProcessor.java and ProviderFactory.java",
                "Error rate spiked from 0.3% to 7.8% at 14:30, exactly 2 minutes after deploy",
                "Logs show NullPointerException at PaymentProcessor.java:247 starting 14:31:07",
              ],
              suggested_action: "Roll back payment-service to v2.4.0 via kubectl rollout undo",
              runbook_url: "https://wiki.example.com/runbooks/rollback",
            },
            {
              rank: 2,
              description: "Missing Stripe SCA provider configuration in payment-providers.yml introduced alongside deploy abc123",
              confidence: 13,
              supporting_evidence: [
                "config/payment-providers.yml was modified in abc123",
                "Log message references missing payment.provider.stripe config key",
              ],
              suggested_action: "Review payment-providers.yml for missing Stripe SCA config entries",
              runbook_url: "https://wiki.example.com/runbooks/null-pointer",
            },
          ],
          timeline: [],
          summary: "Deploy abc123 introduced NPE in PaymentProcessor — recommend immediate rollback to v2.4.0",
        }),
      },
    ],
  },
];

// ── Scenario B: Upstream dependency failure ───────────────────────────────

export const scenarioBResponses: LooseMessage[] = [
  {
    id: "msg_b1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "text", text: "I'll investigate the order-service latency spike." },
      { type: "tool_use", id: "tu_b1", name: "query_metrics",     input: { service: "order-service" } },
      { type: "tool_use", id: "tu_b2", name: "get_recent_deploys", input: { service: "order-service", hours: 48 } },
      { type: "tool_use", id: "tu_b3", name: "get_service_deps",   input: { service: "order-service" } },
      { type: "tool_use", id: "tu_b4", name: "search_logs",        input: { service: "order-service", keyword: "timeout" } },
    ],
  },
  {
    id: "msg_b2",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "text", text: "order-service depends on inventory-service. Checking its metrics." },
      { type: "tool_use", id: "tu_b5", name: "query_metrics",      input: { service: "inventory-service" } },
      { type: "tool_use", id: "tu_b6", name: "search_logs",        input: { service: "inventory-service", keyword: "connection" } },
      { type: "tool_use", id: "tu_b7", name: "get_recent_deploys", input: { service: "inventory-service", hours: 48 } },
      { type: "tool_use", id: "tu_b8", name: "get_past_incidents", input: { service: "inventory-service" } },
    ],
  },
  {
    id: "msg_b3",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 5200, output_tokens: 740, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    content: [
      {
        type: "text",
        text: JSON.stringify({
          hypotheses: [
            {
              rank: 1,
              description: "inventory-db connection pool exhausted (100/100 connections), causing inventory-service CPU spike to 94% and cascading latency to order-service",
              confidence: 91,
              supporting_evidence: [
                "inventory-service CPU spiked from 28% to 94% at 09:22",
                "inventory-db connection pool wait time jumped from 2ms to 4800ms",
                "Logs: Connection pool exhausted: all 100 connections in use, queries queued: 47",
              ],
              suggested_action: "Kill idle inventory-db connections, temporarily increase pool size, deploy PgBouncer",
              runbook_url: "https://wiki.example.com/runbooks/connection-pool",
            },
            {
              rank: 2,
              description: "inventory-db hardware or network issue causing I/O saturation",
              confidence: 9,
              supporting_evidence: ["No code changes correlate with incident"],
              suggested_action: "Check inventory-db slow query log and disk I/O metrics",
              runbook_url: "https://wiki.example.com/runbooks/slow-query",
            },
          ],
          timeline: [],
          summary: "inventory-db connection pool exhausted, cascading latency to order-service",
        }),
      },
    ],
  },
];

// ── Scenario C: No clear cause ────────────────────────────────────────────

export const scenarioCResponses: LooseMessage[] = [
  {
    id: "msg_c1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "text", text: "Investigating intermittent fraud-service errors." },
      { type: "tool_use", id: "tu_c1", name: "query_metrics",     input: { service: "fraud-service" } },
      { type: "tool_use", id: "tu_c2", name: "get_recent_deploys", input: { service: "fraud-service", hours: 72 } },
      { type: "tool_use", id: "tu_c3", name: "search_logs",        input: { service: "fraud-service", level: "ERROR" } },
      { type: "tool_use", id: "tu_c4", name: "get_service_deps",   input: { service: "fraud-service" } },
    ],
  },
  {
    id: "msg_c2",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "text", text: "Errors appear transient. Checking past incidents." },
      { type: "tool_use", id: "tu_c5", name: "search_runbooks",    input: { keywords: ["intermittent", "model", "retry"] } },
      { type: "tool_use", id: "tu_c6", name: "get_past_incidents", input: { service: "fraud-service" } },
    ],
  },
  {
    id: "msg_c3",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 4100, output_tokens: 580, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    content: [
      {
        type: "text",
        text: JSON.stringify({
          hypotheses: [
            {
              rank: 1,
              description: "Intermittent network instability between fraud-service and fraud-model-svc causing transient connection resets and read timeouts",
              confidence: 35,
              supporting_evidence: [
                "Errors appear at irregular intervals (7 spikes over 60 minutes)",
                "All failures are transient — retries succeed in 2-3 attempts",
                "No recent deploys (last deploy 4 days ago)",
              ],
              suggested_action: "Monitor network metrics between fraud-service and fraud-model-svc pods",
              runbook_url: "https://wiki.example.com/runbooks/null-pointer",
            },
            {
              rank: 2,
              description: "fraud-model-svc experiencing periodic GC pauses causing intermittent slowness",
              confidence: 28,
              supporting_evidence: [
                "Pattern consistent with GC stop-the-world pauses (short duration, self-resolving)"
              ],
              suggested_action: "Check fraud-model-svc heap metrics and GC logs",
              runbook_url: "https://wiki.example.com/runbooks/memory-leak",
            },
            {
              rank: 3,
              description: "External rate limiting from an underlying ML infrastructure dependency",
              confidence: 22,
              supporting_evidence: [
                "Past incident inc-007 involved fraud model issues"
              ],
              suggested_action: "Check ML feature store quota metrics",
              runbook_url: "https://wiki.example.com/runbooks/slow-query",
            },
          ],
          timeline: [],
          summary: "fraud-service showing intermittent errors with no clear root cause — evidence inconclusive, human investigation recommended",
        }),
      },
    ],
  },
];
