import type { Alert, Service, Team } from "@shared/types";

export const mockServices: Service[] = [
  {
    id: "svc-api-gateway",
    name: "api-gateway",
    team: "team-platform",
    dependencies: ["svc-auth", "svc-user"],
    healthStatus: "healthy",
  },
  {
    id: "svc-auth",
    name: "auth-service",
    team: "team-security",
    dependencies: ["svc-db-primary"],
    healthStatus: "healthy",
  },
  {
    id: "svc-user",
    name: "user-service",
    team: "team-platform",
    dependencies: ["svc-db-primary", "svc-cache"],
    healthStatus: "healthy",
  },
  {
    id: "svc-db-primary",
    name: "postgres-primary",
    team: "team-infra",
    dependencies: [],
    healthStatus: "healthy",
  },
  {
    id: "svc-cache",
    name: "redis-cache",
    team: "team-infra",
    dependencies: [],
    healthStatus: "healthy",
  },
];

export const mockTeams: Team[] = [
  {
    id: "team-platform",
    name: "Platform",
    slackChannel: "#platform-oncall",
    members: ["alice", "bob"],
  },
  {
    id: "team-security",
    name: "Security",
    slackChannel: "#security-oncall",
    members: ["charlie"],
  },
  {
    id: "team-infra",
    name: "Infrastructure",
    slackChannel: "#infra-oncall",
    members: ["dave", "eve"],
  },
];

export const mockAlerts: Alert[] = [
  {
    id: "alert-001",
    title: "High error rate on api-gateway",
    severity: "critical",
    service: "api-gateway",
    timestamp: new Date("2024-01-15T10:30:00Z"),
    labels: { env: "production", region: "us-east-1" },
    description: "Error rate exceeded 5% threshold for 5 minutes",
  },
];
