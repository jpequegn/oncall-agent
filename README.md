# oncall-agent

An AI-powered SRE incident investigation platform reproducing the core capabilities of [autoheal.ai](https://autoheal.ai).

## What This Is

autoheal.ai is an enterprise AI SRE platform that uses a **Production Context Graph (PCG)** and a multi-agent architecture to autonomously investigate production incidents — correlating metrics, logs, deploys, runbooks, and historical incidents into actionable root cause hypotheses within minutes.

This project reproduces four of its core capabilities:

| # | Project | What It Reproduces |
|---|---------|-------------------|
| 2 | [Service Dependency Graph](./packages/service-graph) | Production Context Graph (PCG) |
| 3 | [AI Investigation Agent](./packages/investigation-agent) | OnCall Agent — multi-step tool-use investigation loop |
| 4 | [Hypothesis Validator Agent](./packages/hypothesis-validator) | Adversarial validation layer |
| 7 | [Slack Incident Bot](./packages/slack-bot) | @Autoheal Slack integration |

## Architecture

```
Slack mention / webhook alert
        │
        ▼
┌───────────────────┐
│  Slack Incident   │  ← packages/slack-bot
│  Bot (Bolt SDK)   │
└────────┬──────────┘
         │ alert payload
         ▼
┌───────────────────┐
│  AI Investigation │  ← packages/investigation-agent
│  Agent (Claude)   │
│                   │
│  Tools:           │
│  • query_metrics  │  ← mock Datadog
│  • search_logs    │  ← mock log store
│  • get_deploys    │  ← mock GitHub API
│  • get_service_   │  ← packages/service-graph
│    deps           │
│  • search_        │  ← pgvector RAG
│    runbooks       │
│  • get_past_      │  ← pgvector RAG
│    incidents      │
└────────┬──────────┘
         │ hypotheses
         ▼
┌───────────────────┐
│  Hypothesis       │  ← packages/hypothesis-validator
│  Validator Agent  │
│  (adversarial)    │
└────────┬──────────┘
         │ validated findings
         ▼
  Slack thread reply
  with action buttons
```

## Stack

- **Language**: TypeScript (bun runtime)
- **AI**: Claude API (`claude-sonnet-4-6`) with tool use
- **Graph DB**: PostgreSQL with recursive CTEs (or Neo4j)
- **Vector DB**: pgvector for RAG over runbooks/incidents
- **Slack**: Bolt SDK
- **Package manager**: bun workspaces

## Project Structure

```
oncall-agent/
├── packages/
│   ├── service-graph/        # Project 2: Service Dependency Graph
│   ├── investigation-agent/  # Project 3: AI Investigation Agent
│   ├── hypothesis-validator/ # Project 4: Hypothesis Validator Agent
│   └── slack-bot/            # Project 7: Slack Incident Bot
├── shared/
│   ├── types/                # Shared TypeScript interfaces
│   └── mock-data/            # Simulated Datadog/GitHub/log responses
├── docker-compose.yml        # PostgreSQL + pgvector
└── IMPLEMENTATION_PLAN.md
```

## Quick Start

```bash
# Install dependencies
bun install

# Start infrastructure
docker-compose up -d

# Run the investigation agent standalone
bun run packages/investigation-agent/src/index.ts

# Start the Slack bot
bun run packages/slack-bot/src/index.ts
```

## See Also

- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — detailed plan for all four projects
- [GitHub Issues](https://github.com/jpequegn/oncall-agent/issues) — task tracking
