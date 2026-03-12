import type { DeploysResponse, DeployRecord } from "./types";

// ── Scenario A: Deploy-caused regression ──────────────────────────────────
// payment-service v2.4.1 deployed at 14:28 — modified PaymentProcessor.java

export const scenarioADeploys: DeploysResponse = {
  service: "payment-service",
  deployments: [
    {
      id: "deploy-pa-001",
      service: "payment-service",
      version: "v2.4.1",
      commitSha: "abc123",
      commitMessage: "feat: add Stripe SCA strong-customer-authentication support",
      author: "bob@example.com",
      deployedAt: "2024-01-15T14:28:00Z",
      environment: "production",
      status: "success",
      filesChanged: [
        { filename: "src/main/java/com/example/payments/PaymentProcessor.java", additions: 87, deletions: 12, status: "modified" },
        { filename: "src/main/java/com/example/payments/ProviderFactory.java",  additions: 43, deletions: 5,  status: "modified" },
        { filename: "src/test/java/com/example/payments/PaymentProcessorTest.java", additions: 55, deletions: 0, status: "modified" },
        { filename: "config/payment-providers.yml", additions: 8, deletions: 2, status: "modified" },
      ],
    },
    {
      id: "deploy-pa-002",
      service: "payment-service",
      version: "v2.4.0",
      commitSha: "def456",
      commitMessage: "fix: retry logic for transient payment gateway errors",
      author: "alice@example.com",
      deployedAt: "2024-01-14T11:15:00Z",
      environment: "production",
      status: "success",
      filesChanged: [
        { filename: "src/main/java/com/example/payments/RetryPolicy.java", additions: 32, deletions: 8, status: "modified" },
      ],
    },
  ],
};

// ── Scenario B: Upstream dependency failure ────────────────────────────────
// No recent deploys for order-service or inventory-service

export const scenarioBDeploys: DeploysResponse = {
  service: "order-service",
  deployments: [
    {
      id: "deploy-pb-001",
      service: "order-service",
      version: "v1.9.3",
      commitSha: "ghi789",
      commitMessage: "chore: bump dependencies, update log format",
      author: "charlie@example.com",
      deployedAt: "2024-01-12T09:45:00Z", // 3 days before incident
      environment: "production",
      status: "success",
      filesChanged: [
        { filename: "package.json", additions: 4, deletions: 4, status: "modified" },
        { filename: "src/logger.ts", additions: 12, deletions: 8, status: "modified" },
      ],
    },
  ],
};

export const scenarioBInventoryDeploys: DeploysResponse = {
  service: "inventory-service",
  deployments: [
    {
      id: "deploy-pb-002",
      service: "inventory-service",
      version: "v2.1.0",
      commitSha: "jkl012",
      commitMessage: "feat: add bulk stock reservation API",
      author: "dave@example.com",
      deployedAt: "2024-01-09T14:00:00Z", // 6 days before incident
      environment: "production",
      status: "success",
      filesChanged: [
        { filename: "src/inventory/reservation.py", additions: 120, deletions: 0, status: "added" },
        { filename: "src/inventory/api.py",         additions: 45,  deletions: 3,  status: "modified" },
      ],
    },
  ],
};

// ── Scenario C: No clear root cause ───────────────────────────────────────
// fraud-service — no recent deploys at all

export const scenarioCDeploys: DeploysResponse = {
  service: "fraud-service",
  deployments: [
    {
      id: "deploy-pc-001",
      service: "fraud-service",
      version: "v3.8.2",
      commitSha: "mno345",
      commitMessage: "fix: improve feature normalization for edge-case inputs",
      author: "eve@example.com",
      deployedAt: "2024-01-11T16:30:00Z", // 4 days before incident
      environment: "production",
      status: "success",
      filesChanged: [
        { filename: "src/features/normalizer.py", additions: 18, deletions: 6, status: "modified" },
      ],
    },
  ],
};

// ── All recent deploys across all services (last 2 hours) ─────────────────

export const recentDeploys: DeployRecord[] = [
  ...scenarioADeploys.deployments.filter(
    (d) => new Date(d.deployedAt) > new Date("2024-01-15T13:00:00Z")
  ),
];
