import { describe, expect, test } from "bun:test";
import {
  buildEmbeddingText,
  generateLocalEmbedding,
  embedInvestigation,
  embedQuery,
} from "../embeddings";
import type { StoredInvestigation } from "../types";

const sampleInvestigation: Omit<StoredInvestigation, "id" | "embedding" | "investigatedAt"> = {
  alertId: "alert-1",
  alertTitle: "payment-service error rate > 5%",
  service: "payment-service",
  severity: "P1",
  scenario: "deploy-regression",
  rootCause: "NullPointerException in PaymentProcessor.java:247 after deploy abc123",
  resolution: "Rollback to v2.4.0",
  summary: "Payment service errors caused by bad deploy",
  hypotheses: [
    {
      description: "Deploy regression in PaymentProcessor",
      confidence: 85,
      evidence: ["Error rate spiked 2min after deploy abc123", "NPE in PaymentProcessor.java:247"],
      suggestedAction: "Rollback to v2.4.0",
    },
  ],
  evidence: ["Error rate spiked 2min after deploy abc123"],
  topConfidence: 85,
  escalated: false,
};

describe("buildEmbeddingText", () => {
  test("includes service, alert, and root cause", () => {
    const text = buildEmbeddingText(sampleInvestigation);
    expect(text).toContain("payment-service");
    expect(text).toContain("error rate > 5%");
    expect(text).toContain("NullPointerException");
    expect(text).toContain("Rollback to v2.4.0");
  });

  test("includes hypothesis details", () => {
    const text = buildEmbeddingText(sampleInvestigation);
    expect(text).toContain("Deploy regression");
    expect(text).toContain("85%");
    expect(text).toContain("NPE in PaymentProcessor");
  });

  test("includes correction when present", () => {
    const corrected = {
      ...sampleInvestigation,
      feedback: "corrected" as const,
      correctionText: "Actually it was a database migration issue",
    };
    const text = buildEmbeddingText(corrected);
    expect(text).toContain("database migration issue");
  });
});

describe("generateLocalEmbedding", () => {
  test("returns a 1024-dimensional vector", () => {
    const vec = generateLocalEmbedding("test input");
    expect(vec.length).toBe(1024);
  });

  test("returns normalized vector (unit length)", () => {
    const vec = generateLocalEmbedding("some investigation text");
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(Math.abs(norm - 1.0)).toBeLessThan(0.001);
  });

  test("is deterministic for the same input", () => {
    const v1 = generateLocalEmbedding("payment-service error rate spike");
    const v2 = generateLocalEmbedding("payment-service error rate spike");
    expect(v1).toEqual(v2);
  });

  test("differs for different inputs", () => {
    const v1 = generateLocalEmbedding("payment-service error rate spike");
    const v2 = generateLocalEmbedding("order-service latency timeout");
    // Cosine similarity should be < 1.0
    const dot = v1.reduce((sum, a, i) => sum + a * v2[i], 0);
    expect(dot).toBeLessThan(0.99);
  });

  test("similar texts produce higher cosine similarity", () => {
    const vPayment1 = generateLocalEmbedding("payment-service error rate spike after deploy");
    const vPayment2 = generateLocalEmbedding("payment-service error rate increased following deployment");
    const vUnrelated = generateLocalEmbedding("dns resolution timeout in kubernetes cluster");

    const sim12 = vPayment1.reduce((sum, a, i) => sum + a * vPayment2[i], 0);
    const sim13 = vPayment1.reduce((sum, a, i) => sum + a * vUnrelated[i], 0);

    expect(sim12).toBeGreaterThan(sim13);
  });
});

describe("embedInvestigation", () => {
  test("generates embedding from investigation data", async () => {
    const vec = await embedInvestigation(sampleInvestigation);
    expect(vec.length).toBe(1024);
  });

  test("uses custom embedFn when provided", async () => {
    const customFn = async (text: string) => {
      expect(text).toContain("payment-service");
      return new Array(1024).fill(0.5);
    };
    const vec = await embedInvestigation(sampleInvestigation, customFn);
    expect(vec.every((v) => v === 0.5)).toBe(true);
  });
});

describe("embedQuery", () => {
  test("generates embedding from query string", async () => {
    const vec = await embedQuery("payment service errors after deploy");
    expect(vec.length).toBe(1024);
  });

  test("uses custom embedFn when provided", async () => {
    const customFn = async (_text: string) => new Array(1024).fill(0.1);
    const vec = await embedQuery("test query", customFn);
    expect(vec.every((v) => v === 0.1)).toBe(true);
  });
});
