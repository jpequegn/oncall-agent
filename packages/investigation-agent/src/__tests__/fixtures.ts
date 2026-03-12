/**
 * Pre-recorded API response fixtures for deterministic agent tests.
 * Each scenario simulates two turns: tool_use → end_turn with final JSON.
 */
// Use a looser type so we can build minimal fixture objects without satisfying
// every field the real SDK requires (e.g. citations on TextBlock).
type LooseMessage = Omit<import("@anthropic-ai/sdk/resources/messages/messages").Message, "content"> & {
  content: unknown[];
};

// ── Shared tool call ids ───────────────────────────────────────────────────

function usage() {
  return { input_tokens: 1200, output_tokens: 480, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

// ── Scenario A: Deploy regression ─────────────────────────────────────────

export const scenarioAResponses: LooseMessage[] = [
  // Turn 1: Claude requests 4 tools in parallel
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
  // Turn 2: Claude produces final JSON after reviewing tool results
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
                "Logs show 'NullPointerException: Cannot invoke method getProvider() on null object at PaymentProcessor.java:247' starting 14:31:07",
                "Warning at 14:31:22: 'payment.provider.stripe config returned null — possible misconfiguration in ProviderFactory'",
                "api-gateway 5xx rate also rose from 0.1% to 2.1% as downstream effect"
              ],
              suggested_action: "Roll back payment-service to v2.4.0 (commit def456) immediately via kubectl rollout undo",
              runbook_url: "https://wiki.example.com/runbooks/rollback",
            },
            {
              rank: 2,
              description: "Missing Stripe SCA provider configuration in payment-providers.yml introduced alongside deploy abc123",
              confidence: 13,
              supporting_evidence: [
                "config/payment-providers.yml was modified in abc123",
                "Log message references missing 'payment.provider.stripe' config key"
              ],
              suggested_action: "If rollback resolves, review payment-providers.yml for missing Stripe SCA config entries",
              runbook_url: "https://wiki.example.com/runbooks/null-pointer",
            },
          ],
          timeline: [
            { timestamp: "2024-01-15T14:28:00Z", event_type: "deploy",       description: "Deploy abc123 (v2.4.1) rolled out: PaymentProcessor.java, ProviderFactory.java modified" },
            { timestamp: "2024-01-15T14:30:00Z", event_type: "metric_spike", description: "payment-service error rate spikes from 0.3% to 7.8%" },
            { timestamp: "2024-01-15T14:31:07Z", event_type: "error_surge",  description: "NullPointerException at PaymentProcessor.java:247 begins appearing in logs" },
            { timestamp: "2024-01-15T14:35:50Z", event_type: "metric_spike", description: "api-gateway 5xx rate rises to 2.1% as downstream effect" },
          ],
          summary: "Deploy abc123 introduced NPE in PaymentProcessor — recommend immediate rollback to v2.4.0",
        }),
      },
    ],
  },
];

// ── Scenario B: Upstream dependency failure ───────────────────────────────

export const scenarioBResponses: LooseMessage[] = [
  // Turn 1: 5 tool calls
  {
    id: "msg_b1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "text", text: "I'll investigate the order-service latency spike. Gathering evidence in parallel." },
      { type: "tool_use", id: "tu_b1", name: "query_metrics",     input: { service: "order-service" } },
      { type: "tool_use", id: "tu_b2", name: "get_recent_deploys", input: { service: "order-service", hours: 48 } },
      { type: "tool_use", id: "tu_b3", name: "get_service_deps",   input: { service: "order-service" } },
      { type: "tool_use", id: "tu_b4", name: "search_logs",        input: { service: "order-service", keyword: "timeout" } },
    ],
  },
  // Turn 2: Follow up on inventory-service after seeing deps
  {
    id: "msg_b2",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "text", text: "order-service depends on inventory-service. Let me check its metrics and logs." },
      { type: "tool_use", id: "tu_b5", name: "query_metrics",      input: { service: "inventory-service" } },
      { type: "tool_use", id: "tu_b6", name: "search_logs",        input: { service: "inventory-service", keyword: "connection" } },
      { type: "tool_use", id: "tu_b7", name: "get_recent_deploys", input: { service: "inventory-service", hours: 48 } },
      { type: "tool_use", id: "tu_b8", name: "get_past_incidents", input: { service: "inventory-service" } },
    ],
  },
  // Turn 3: Final JSON
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
                "inventory-db connection pool wait time jumped from 2ms to 4800ms at 09:22",
                "Logs: 'Connection timeout to inventory-db after 5000ms: too many clients already'",
                "Logs: 'Connection pool exhausted: all 100 connections in use, queries queued: 47'",
                "order-service latency spiked 2 minutes later (09:22 → 09:24) after inventory-service degraded",
                "No recent deploys in inventory-service (last deploy 6 days ago)",
                "Past incident inc-003 has identical pattern: flash sale causing connection pool exhaustion"
              ],
              suggested_action: "Kill idle inventory-db connections, temporarily increase pool size, deploy PgBouncer",
              runbook_url: "https://wiki.example.com/runbooks/connection-pool",
            },
            {
              rank: 2,
              description: "inventory-db hardware or network issue causing I/O saturation",
              confidence: 9,
              supporting_evidence: [
                "No code changes correlate with incident",
                "Connection exhaustion could stem from slow queries locking connections"
              ],
              suggested_action: "Check inventory-db slow query log and disk I/O metrics",
              runbook_url: "https://wiki.example.com/runbooks/slow-query",
            },
          ],
          timeline: [
            { timestamp: "2024-01-15T09:22:18Z", event_type: "metric_spike", description: "inventory-db connection pool at 85/100 — warning threshold hit" },
            { timestamp: "2024-01-15T09:22:41Z", event_type: "error_surge",  description: "inventory-service: connection timeout errors to inventory-db begin" },
            { timestamp: "2024-01-15T09:22:55Z", event_type: "metric_spike", description: "inventory-service CPU reaches 94%" },
            { timestamp: "2024-01-15T09:23:10Z", event_type: "error_surge",  description: "order-service: upstream inventory-service timeout errors begin" },
            { timestamp: "2024-01-15T09:23:30Z", event_type: "error_surge",  description: "inventory-db pool fully exhausted: 100/100 connections, 47 queries queued" },
          ],
          summary: "inventory-db connection pool exhausted, cascading latency to inventory-service and order-service — no recent deploy correlation",
        }),
      },
    ],
  },
];

// ── Scenario C: No clear cause ────────────────────────────────────────────

export const scenarioCResponses: LooseMessage[] = [
  // Turn 1: Initial evidence gathering
  {
    id: "msg_c1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "text", text: "Investigating intermittent fraud-service errors. Gathering evidence." },
      { type: "tool_use", id: "tu_c1", name: "query_metrics",     input: { service: "fraud-service" } },
      { type: "tool_use", id: "tu_c2", name: "get_recent_deploys", input: { service: "fraud-service", hours: 72 } },
      { type: "tool_use", id: "tu_c3", name: "search_logs",        input: { service: "fraud-service", level: "ERROR" } },
      { type: "tool_use", id: "tu_c4", name: "get_service_deps",   input: { service: "fraud-service" } },
    ],
  },
  // Turn 2: Follow-up on fraud-model-svc
  {
    id: "msg_c2",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(),
    content: [
      { type: "text", text: "Errors appear transient with successful retries. Checking upstream dependencies and past incidents." },
      { type: "tool_use", id: "tu_c5", name: "search_runbooks",    input: { keywords: ["intermittent", "model", "retry"] } },
      { type: "tool_use", id: "tu_c6", name: "get_past_incidents", input: { service: "fraud-service" } },
    ],
  },
  // Turn 3: Final JSON — all low confidence, escalate
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
                "Errors appear at irregular intervals with no consistent pattern (7 spikes over 60 minutes)",
                "All failures are transient — retries succeed in 2-3 attempts",
                "No recent deploys (last deploy 4 days ago)",
                "Error types vary: 'unknown error', 'connection reset by peer', 'upstream read timeout'"
              ],
              suggested_action: "Monitor network metrics between fraud-service and fraud-model-svc pods; check for noisy neighbour issues",
              runbook_url: "https://wiki.example.com/runbooks/null-pointer",
            },
            {
              rank: 2,
              description: "fraud-model-svc experiencing periodic GC pauses or resource contention causing intermittent slowness",
              confidence: 28,
              supporting_evidence: [
                "Errors correlate with brief latency spikes on fraud-service",
                "Pattern consistent with GC stop-the-world pauses (short duration, self-resolving)"
              ],
              suggested_action: "Check fraud-model-svc heap metrics and GC logs; consider tuning GC parameters",
              runbook_url: "https://wiki.example.com/runbooks/memory-leak",
            },
            {
              rank: 3,
              description: "External rate limiting or throttling from an underlying ML infrastructure dependency",
              confidence: 22,
              supporting_evidence: [
                "Spikes correlate loosely with traffic patterns but not consistently",
                "Past incident inc-007 involved fraud model issues with external service impact"
              ],
              suggested_action: "Check ML feature store and model serving infrastructure quota metrics",
              runbook_url: "https://wiki.example.com/runbooks/slow-query",
            },
          ],
          timeline: [
            { timestamp: "2024-01-15T22:05:33Z", event_type: "error_surge",  description: "First error spike — 'unknown error from fraud-model-svc', resolved on retry" },
            { timestamp: "2024-01-15T22:13:07Z", event_type: "error_surge",  description: "Second spike — 'connection reset by peer'" },
            { timestamp: "2024-01-15T22:27:41Z", event_type: "error_surge",  description: "Third spike — falls back to rule-based scoring after 3 failed retries" },
            { timestamp: "2024-01-15T22:44:19Z", event_type: "error_surge",  description: "Fourth spike — 'upstream read timeout'" },
          ],
          summary: "fraud-service showing intermittent errors with no clear root cause — evidence inconclusive, human investigation recommended",
        }),
      },
    ],
  },
];
