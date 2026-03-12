/**
 * Pre-recorded Anthropic API response fixtures for deterministic validator tests.
 */
type LooseMessage = Omit<import("@anthropic-ai/sdk/resources/messages/messages").Message, "content"> & {
  content: unknown[];
};

function usage() {
  return { input_tokens: 1800, output_tokens: 520, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

// ── Scenario A: Deploy regression — correct hypothesis, validator barely challenged ──

export const scenarioAValidatorResponse: LooseMessage = {
  id: "msg_va1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: usage(),
  content: [
    {
      type: "text",
      text: JSON.stringify({
        validated_hypotheses: [
          {
            original_rank: 1,
            original_confidence: 87,
            challenge_score: 10,
            key_objections: [
              "The config file change in abc123 could have been a pre-planned update unrelated to the NullPointerException"
            ],
            missing_evidence: [
              "Stack trace confirming ProviderFactory.getProvider() is the exact call site",
              "Whether the config change was intentional or accidental"
            ],
            alternative_explanation: "Config change was intentional but incomplete — the Stripe SCA key was simply not populated in the deploy environment",
            revised_confidence: 78,
          },
          {
            original_rank: 2,
            original_confidence: 13,
            challenge_score: 20,
            key_objections: [
              "If only config was missing, error would occur at startup, not 2 minutes after deploy"
            ],
            missing_evidence: [
              "Evidence that missing config key is a runtime vs startup failure"
            ],
            revised_confidence: 10,
          },
        ],
        validator_notes: "The deploy-correlated timing is strong. Hypothesis 1 is well-supported — minor config ambiguity does not undermine the NPE evidence chain.",
      }),
    },
  ],
};

// ── Scenario C: No clear cause — validator escalates ──────────────────────

export const scenarioCValidatorResponse: LooseMessage = {
  id: "msg_vc1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: usage(),
  content: [
    {
      type: "text",
      text: JSON.stringify({
        validated_hypotheses: [
          {
            original_rank: 1,
            original_confidence: 35,
            challenge_score: 60,
            key_objections: [
              "Errors are fully transient with successful retries — classic GC pause, not network instability",
              "No pod restart or network event logs correlated with the 7 spikes",
              "Network instability usually manifests as sustained degradation, not brief self-resolving spikes"
            ],
            missing_evidence: [
              "Network connectivity metrics between pods during spike windows",
              "TCP retransmit counters",
              "Absence of GC pause logs from fraud-model-svc"
            ],
            alternative_explanation: "GC stop-the-world pauses in fraud-model-svc causing brief unresponsiveness",
            revised_confidence: 14,
          },
          {
            original_rank: 2,
            original_confidence: 28,
            challenge_score: 55,
            key_objections: [
              "No heap metrics provided to confirm GC pressure",
              "Pattern is consistent but 7 spikes over 60 minutes is irregular for typical GC cycles"
            ],
            missing_evidence: [
              "fraud-model-svc JVM heap usage and GC logs",
              "GC pause duration measurements"
            ],
            revised_confidence: 13,
          },
          {
            original_rank: 3,
            original_confidence: 22,
            challenge_score: 50,
            key_objections: [
              "Throttling typically produces consistent 429 errors, not varied error types",
              "Past incident inc-007 context is too vague to be confirmatory"
            ],
            missing_evidence: [
              "Rate limit headers or quota metrics from ML feature store",
              "Error code breakdown (429 vs 5xx vs connection errors)"
            ],
            revised_confidence: 11,
          },
        ],
        escalation_reason: "All hypotheses have low original confidence and the adversarial review further reduces them — top hypothesis revised confidence is 14%, well below the 40% threshold. Human investigation is required.",
        validator_notes: "Evidence is genuinely insufficient across all hypotheses. The investigation correctly identified inconclusive findings. Escalation to on-call engineers is warranted.",
      }),
    },
  ],
};
