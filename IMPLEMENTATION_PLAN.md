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

**Pattern**: Production Context Graph (PCG) — a continuously-updating knowledge graph connecting infrastructure topology, code, and ownership.

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

**Pattern**: OnCall Agent — a multi-step tool-use investigation loop.

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

**Pattern**: Adversarial validation layer — a "devil's advocate" agent that stress-tests hypotheses before they become engineer recommendations.

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

## Project 7: Bot Core + Slack + Teams

Both messaging platforms share the same investigation pipeline. The bot layer is split into three packages:

```
packages/
  bot-core/      ← platform-agnostic orchestration, alert parsing, result model
  slack-bot/     ← Bolt SDK adapter + Block Kit formatter
  teams-bot/     ← Bot Framework adapter + Adaptive Cards formatter
```

---

### Project 7a: Bot Core (shared layer)

**Goal**: Extract all platform-agnostic logic so it can be reused by both Slack and Teams adapters without duplication.

#### BotAdapter Interface

```typescript
// packages/bot-core/src/adapter.ts
export interface MessageContext {
  channelId: string;
  threadId: string;
  userId: string;
  platform: "slack" | "teams";
}

export interface ActionContext extends MessageContext {
  actionId: string;
  value: string;
  messageTs: string;
}

export interface BotAdapter {
  postMessage(ctx: MessageContext, message: BotMessage): Promise<{ messageId: string }>;
  updateMessage(ctx: MessageContext, messageId: string, message: BotMessage): Promise<void>;
  onMention(handler: (text: string, ctx: MessageContext) => Promise<void>): void;
  onAction(actionId: string, handler: (ctx: ActionContext) => Promise<void>): void;
}
```

#### BotMessage (platform-agnostic result model)

```typescript
export interface BotMessage {
  text: string;                        // fallback plain text
  blocks?: InvestigationBlocks;        // structured data; each adapter renders to its format
}

export interface InvestigationBlocks {
  type: "investigation_result";
  alert: Alert;
  hypotheses: ValidatedHypothesis[];
  timeline: TimelineEvent[];
  duration_ms: number;
  tool_call_count: number;
  escalate: boolean;
}
```

#### Core Orchestration (lives once, used by both adapters)

```typescript
// packages/bot-core/src/orchestrator.ts
export async function handleIncidentMention(
  text: string,
  ctx: MessageContext,
  adapter: BotAdapter,
  onProgress: (msg: string) => Promise<void>
): Promise<void> {
  const alert = await parseAlert(text);
  await onProgress("🔍 Investigating `" + alert.service + "`...");
  const investigation = await runFullInvestigation(alert, {
    onToolCall: (name) => onProgress(`✓ ${formatToolName(name)}`),
  });
  await adapter.postMessage(ctx, { text: formatSummary(investigation), blocks: investigation });
}
```

#### Implementation Steps

1. Define `BotAdapter` interface and `BotMessage` / `InvestigationBlocks` types
2. Move alert parser from `slack-bot` into `bot-core`
3. Move pipeline orchestration into `bot-core/src/orchestrator.ts`
4. Move feedback loop (knowledge base write on confirmation) into `bot-core`
5. Export typed `formatToolName` and `formatSummary` helpers

---

### Project 7b: Slack Bot (Bolt adapter)

**Goal**: Implement `BotAdapter` using Slack Bolt SDK + render `InvestigationBlocks` as Block Kit.

#### Interaction Pattern

```
Engineer: @oncall-agent payment-service is throwing 500s since the 14:30 deploy

Bot: 🔍 Investigating payment-service...
     ✓ Queried metrics  ✓ Searched logs  ✓ Checked deploys

Bot: 📊 Investigation Complete (47s)

     Root cause hypothesis (confidence: 78%):
     NullPointerException in PaymentProcessor v2.1.3 (deploy abc123, 14:28 UTC)

     Evidence:
     • Error rate 0.1% → 8.3% at 14:31 UTC
     • Deploy abc123 touched PaymentProcessor.java
     • Stack trace: NullPointerException at PaymentProcessor:247

     [👍 Correct]  [❌ Wrong]  [🔍 Dig deeper]
```

#### Implementation Steps

1. **Bolt SDK setup** — `app_mention` + `/investigate` slash command
2. **SlackAdapter** — implement `BotAdapter` interface using `app.client`
3. **Block Kit renderer** — render `InvestigationBlocks` → Slack Block Kit JSON
4. **Action handlers** — wire `hypothesis_confirm`, `hypothesis_reject`, `investigate_more` to `bot-core` handlers
5. **Environment config** — `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `ANTHROPIC_API_KEY`

---

### Project 7c: Teams Bot (Bot Framework adapter)

**Goal**: Implement `BotAdapter` using the Microsoft Bot Framework SDK + render `InvestigationBlocks` as Adaptive Cards.

#### Differences from Slack

| Concern | Slack | Teams |
|---------|-------|-------|
| SDK | `@slack/bolt` | `botbuilder` |
| Auth | Signing secret + bot token | Azure App Registration (client ID + secret) |
| Message format | Block Kit JSON | Adaptive Cards JSON |
| Triggers | `app_mention` event | `onMessage` activity handler |
| Action buttons | `app.action()` | `onInvokeActivity` handler |
| Hosting | Any HTTP | Azure Bot Service (or self-hosted with ngrok) |

#### Adaptive Card (equivalent to Block Kit result)

```json
{
  "type": "AdaptiveCard",
  "version": "1.5",
  "body": [
    { "type": "TextBlock", "text": "📊 Investigation: payment-service", "weight": "Bolder", "size": "Medium" },
    { "type": "FactSet", "facts": [
      { "title": "Duration", "value": "47s" },
      { "title": "Tool calls", "value": "8" },
      { "title": "Confidence", "value": "78%" }
    ]},
    { "type": "TextBlock", "text": "NullPointerException in PaymentProcessor v2.1.3", "wrap": true },
    { "type": "TextBlock", "text": "• Error rate 0.1% → 8.3% at 14:31 UTC\n• Deploy abc123 at 14:28 UTC", "wrap": true }
  ],
  "actions": [
    { "type": "Action.Submit", "title": "👍 Correct", "data": { "actionId": "hypothesis_confirm" } },
    { "type": "Action.Submit", "title": "❌ Wrong", "data": { "actionId": "hypothesis_reject" } },
    { "type": "Action.Submit", "title": "🔍 Dig deeper", "data": { "actionId": "investigate_more" } }
  ]
}
```

#### Implementation Steps

1. **Bot Framework setup** — `ActivityHandler` subclass, register with Azure Bot Service
2. **TeamsAdapter** — implement `BotAdapter` interface using `TurnContext`
3. **Adaptive Cards renderer** — render `InvestigationBlocks` → Adaptive Card JSON
4. **Invoke activity handler** — handle `Action.Submit` from Adaptive Card buttons
5. **Environment config** — `MICROSOFT_APP_ID`, `MICROSOFT_APP_PASSWORD`, `ANTHROPIC_API_KEY`
6. **Local testing** — ngrok tunnel + Bot Framework Emulator

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

Week 4: Project 7a — Bot Core + Project 7b — Slack Bot
  - Bot Core: BotAdapter interface + alert parser + orchestrator (days 1-2)
  - Slack: Bolt setup + SlackAdapter + Block Kit renderer (days 3-4)
  - Slack: action handlers + tests (day 5)

Week 5: Project 7c — Teams Bot
  - Bot Framework setup + TeamsAdapter (days 1-2)
  - Adaptive Cards renderer (day 3)
  - Invoke activity handler + local testing with emulator (day 4)
  - Tests (day 5)
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
  source: "pagerduty" | "datadog" | "slack" | "teams" | "manual";
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
