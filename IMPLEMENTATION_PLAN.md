# Implementation Plan

## Overview

Four projects, designed to be built in dependency order:

```
Project 2: Service Dependency Graph   (foundation — provides get_service_deps tool)
    ↓
Project 3: AI Investigation Agent     (core — uses graph + all mock tools)
    ↓
Project 4: Hypothesis Validator Agent (layer on top of Project 3 output)
    ↓
Project 7: Slack Incident Bot         (interface — orchestrates Projects 3 + 4)
```

---

## Project 2: Service Dependency Graph

**Goal**: Build a queryable graph of service relationships that the Investigation Agent can call as a tool.

**What it reproduces**: autoheal.ai's Production Context Graph (PCG) — the continuously-updating knowledge graph connecting infrastructure topology, code, and ownership.

### Data Model

```
Nodes:
  Service   { id, name, tier, language, repo_url }
  Team      { id, name, slack_channel, oncall_rotation }
  Runbook   { id, title, url, tags[] }
  Deployment { id, service_id, version, commit_sha, deployed_at, deployer }
  Incident  { id, title, severity, root_cause, resolution, occurred_at }

Edges:
  Service  -[DEPENDS_ON]->    Service
  Service  -[OWNED_BY]->      Team
  Service  -[HAS_RUNBOOK]->   Runbook
  Deployment -[DEPLOYED_TO]-> Service
  Incident -[AFFECTED]->      Service
  Incident -[CAUSED_BY]->     Deployment
```

### Implementation Steps

1. **Database schema** — PostgreSQL with recursive CTEs for transitive dependency traversal
2. **Seed script** — populate 10–15 realistic services (payment-service, auth-service, order-service, notification-service, etc.) with realistic dependency edges
3. **Graph query functions**:
   - `getDirectDependencies(serviceId)` → immediate upstream/downstream
   - `getTransitiveDependencies(serviceId, depth)` → full dependency tree
   - `getServiceOwner(serviceId)` → team + on-call info
   - `findCriticalPath(from, to)` → shortest path in dependency graph
4. **REST API** (or direct function export) for use as an agent tool
5. **Visualization endpoint** — D3.js or simple JSON for graph rendering

### Tech Stack
- PostgreSQL 16 with ltree or recursive CTE
- TypeScript + Drizzle ORM
- Bun HTTP server for the API layer

---

## Project 3: AI Investigation Agent

**Goal**: An LLM agent that receives an alert and autonomously investigates it using tool use, producing structured root cause hypotheses.

**What it reproduces**: autoheal.ai's OnCall Agent — the multi-step tool-use investigation loop.

### Investigation Flow

```
1. Alert received → normalize (service, severity, start_time, symptoms)
2. Gather evidence in parallel:
   - query_metrics(service, time_range)        → Datadog-style metric data
   - search_logs(service, time_range, pattern) → error log excerpts
   - get_recent_deploys(service, hours=2)      → recent GitHub deploys
   - get_service_deps(service)                 → upstream/downstream
   - search_runbooks(error_type)               → matching runbooks
   - get_past_incidents(symptoms)              → similar historical incidents
3. Construct timeline: correlate deploy timestamps with metric spikes
4. Generate hypotheses: ranked list with confidence scores
5. Output: structured JSON with hypotheses, evidence, suggested actions
```

### Tool Definitions (Claude API format)

```typescript
const tools = [
  {
    name: "query_metrics",
    description: "Fetch metrics for a service over a time range. Returns p50/p95/p99 latency, error rate, throughput.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string" },
        metric: { type: "string", enum: ["latency", "error_rate", "throughput", "cpu", "memory"] },
        start_time: { type: "string", description: "ISO8601" },
        end_time: { type: "string", description: "ISO8601" }
      },
      required: ["service", "metric", "start_time", "end_time"]
    }
  },
  {
    name: "search_logs",
    description: "Search recent log entries for a service matching a pattern.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string" },
        pattern: { type: "string", description: "Regex or keyword to search for" },
        time_range_minutes: { type: "number" }
      },
      required: ["service", "pattern"]
    }
  },
  {
    name: "get_recent_deploys",
    description: "Get recent deployments for a service from GitHub.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string" },
        hours: { type: "number", default: 2 }
      },
      required: ["service"]
    }
  },
  {
    name: "get_service_deps",
    description: "Get upstream and downstream service dependencies.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string" },
        direction: { type: "string", enum: ["upstream", "downstream", "both"] }
      },
      required: ["service"]
    }
  },
  {
    name: "search_runbooks",
    description: "Find runbooks matching an error type or symptom description.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Error type, symptom, or keyword" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_past_incidents",
    description: "Retrieve similar past incidents and their resolutions using semantic search.",
    input_schema: {
      type: "object",
      properties: {
        symptoms: { type: "string", description: "Description of current symptoms" },
        limit: { type: "number", default: 5 }
      },
      required: ["symptoms"]
    }
  }
]
```

### Output Schema

```typescript
interface InvestigationResult {
  incident_id: string;
  service: string;
  investigation_duration_ms: number;
  hypotheses: Array<{
    rank: number;
    description: string;
    confidence: number;          // 0-100
    supporting_evidence: string[];
    contradicting_evidence: string[];
    suggested_action: string;
    runbook_url?: string;
  }>;
  timeline: Array<{
    timestamp: string;
    event_type: "deploy" | "metric_spike" | "error_surge" | "config_change";
    description: string;
    service: string;
  }>;
  raw_tool_calls: ToolCall[];    // full audit trail
}
```

### Implementation Steps

1. **Mock data layer** — realistic Datadog/GitHub/log responses for 3–5 incident scenarios
2. **Tool executor** — routes tool calls to mock data or real service-graph API
3. **Agent loop** — Claude API with tool_use content blocks, handles multi-turn
4. **System prompt** — SRE persona, output format enforcement, chain-of-thought
5. **CLI runner** — `bun run investigate --alert "payment-service 500s spiking"`
6. **Unit tests** — verify tool routing, output schema, confidence scoring

---

## Project 4: Hypothesis Validator Agent

**Goal**: A second LLM agent that receives the Investigation Agent's hypotheses and adversarially challenges each one, improving signal quality before presenting to engineers.

**What it reproduces**: autoheal.ai's adversarial validation layer — a "devil's advocate" agent that stress-tests hypotheses before they become engineer recommendations.

### Validation Flow

```
1. Receive: investigation result (hypotheses + evidence + timeline)
2. For each hypothesis, challenge:
   a. What evidence directly contradicts this hypothesis?
   b. What would we expect to observe if this were true that we did NOT see?
   c. Is the timing correlation strong enough to imply causation?
   d. Could this be a symptom of a deeper upstream cause?
3. Output: each hypothesis annotated with:
   - challenge_strength: 0-100 (100 = very strong challenge = low confidence in hypothesis)
   - key_objections: string[]
   - missing_evidence: what would confirm/deny this
   - revised_confidence: updated confidence after adversarial review
4. Escalation flag: if all hypotheses challenged strongly → "needs human investigation"
```

### System Prompt Pattern

```
You are an adversarial SRE reviewer. You will be given a set of root cause hypotheses
for a production incident. Your job is NOT to find the root cause — it is to find flaws
in the reasoning.

For each hypothesis:
1. Challenge the evidence — is it correlation or causation?
2. Identify what evidence is MISSING that would confirm this hypothesis
3. Find alternative explanations the primary investigator may have missed
4. Rate your confidence that this hypothesis is WRONG (0-100%)

Be rigorous. Be skeptical. The goal is to eliminate weak hypotheses before
they waste an engineer's time.
```

### Implementation Steps

1. **Validator agent** — separate Claude API call with adversarial system prompt
2. **Hypothesis scoring** — combine original confidence with adversarial challenge score
3. **Confidence recalibration** — formula: `revised = original * (1 - challenge_strength/100)`
4. **Minimum evidence check** — flag hypotheses with <2 supporting data points
5. **Escalation logic** — if top hypothesis revised_confidence <40%, mark as "inconclusive"
6. **Integration test** — run validator on 3 pre-built investigation results, verify output

---

## Project 7: Slack Incident Bot

**Goal**: A Slack bot that listens for @Autoheal mentions or PagerDuty-style webhook alerts, triggers the investigation + validation pipeline, and posts findings in a threaded, interactive format.

**What it reproduces**: autoheal.ai's Slack integration — the primary engineer interface for incident investigation.

### Interaction Pattern

```
Engineer: @Autoheal payment-service is throwing 500s since the 14:30 deploy

Bot: 🔍 Investigating payment-service...
     Querying metrics, logs, recent deploys...

Bot: 📊 Investigation Complete (47s)

     Root cause hypothesis (confidence: 78%):
     Null pointer exception in PaymentProcessor v2.1.3
     introduced in deploy abc123 at 14:28 UTC

     Evidence:
     • Error rate spiked from 0.1% → 8.3% at 14:31 UTC
     • Deploy abc123 touched PaymentProcessor.java
     • Stack trace: NullPointerException at line 247
     • No upstream dependency changes in past 2 hours

     Adversarial check: hypothesis confirmed (challenge score: 12/100)

     Runbook: https://wiki/payment-service/null-ptr-runbook

     [👍 This looks right]  [❌ Wrong hypothesis]  [🔍 Investigate further]
```

### Implementation Steps

1. **Bolt SDK setup** — handle `app_mention` events and slash command `/investigate`
2. **Webhook receiver** — parse PagerDuty/Alertmanager webhook format into investigation request
3. **Pipeline orchestration** — call Investigation Agent → Hypothesis Validator → format output
4. **Streaming updates** — post intermediate status messages ("Querying Datadog... ✓")
5. **Thread management** — post investigation results as threaded replies
6. **Action buttons** — handle 👍 / ❌ / 🔍 interactions, route to appropriate response
7. **Feedback loop** — on 👍, store confirmed root cause in incident knowledge base (pgvector)
8. **Environment config** — `.env` with `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `ANTHROPIC_API_KEY`

---

## Build Order & Dependencies

```
Week 1: Project 2 — Service Dependency Graph
  - Schema + seed data (days 1-2)
  - Query functions + API (days 3-4)
  - Tests (day 5)

Week 2: Project 3 — AI Investigation Agent
  - Mock data layer (day 1)
  - Tool executor + Claude API integration (days 2-3)
  - Agent loop + system prompt (day 4)
  - CLI runner + tests (day 5)

Week 3: Project 4 — Hypothesis Validator Agent
  - Adversarial agent + system prompt (days 1-2)
  - Confidence recalibration formula (day 3)
  - Integration tests (days 4-5)

Week 4: Project 7 — Slack Incident Bot
  - Bolt setup + event handling (days 1-2)
  - Pipeline orchestration (day 3)
  - Streaming + thread management (day 4)
  - Action buttons + feedback loop (day 5)
```

---

## Shared Infrastructure

```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: oncall_agent
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
```

### Shared Types

```typescript
// shared/types/index.ts
export interface Alert {
  id: string;
  service: string;
  severity: "P1" | "P2" | "P3" | "P4";
  title: string;
  description: string;
  started_at: string;
  source: "pagerduty" | "datadog" | "slack" | "manual";
}

export interface Service {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  owner_team: string;
  repo_url: string;
  dependencies: string[];
}
```
