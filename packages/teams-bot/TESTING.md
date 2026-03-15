# Teams Bot — Testing Guide

## Unit Tests

Run all teams-bot tests:

```bash
bun run --filter '@oncall/teams-bot' test
```

### Coverage

| Area | Tests | File |
|------|-------|------|
| TeamsAdapter message handling | 6 | `bot.test.ts` |
| TeamsAdapter postMessage | 4 | `bot.test.ts` |
| TeamsAdapter action handlers | 4 | `bot.test.ts` |
| TeamsAdapter member greeting | 1 | `bot.test.ts` |
| TeamsAdapter BotAdapter interface | 1 | `bot.test.ts` |
| Adaptive Card structure | 2 | `adaptive-card.test.ts` |
| Adaptive Card FactSet | 1 | `adaptive-card.test.ts` |
| Adaptive Card hypotheses | 4 | `adaptive-card.test.ts` |
| Adaptive Card evidence truncation | 2 | `adaptive-card.test.ts` |
| Adaptive Card actions | 2 | `adaptive-card.test.ts` |
| Adaptive Card escalation | 1 | `adaptive-card.test.ts` |
| Adaptive Card secondary hypotheses | 4 | `adaptive-card.test.ts` |
| Adaptive Card missing runbook | 2 | `adaptive-card.test.ts` |
| Adaptive Card snapshots | 2 | `adaptive-card.test.ts` |

## Bot Framework Emulator (Manual Testing)

### Setup

1. Install the Bot Framework Emulator:
   ```bash
   brew install --cask botframework-emulator
   ```

2. Start the bot in local dev mode:
   ```bash
   bun run packages/teams-bot/src/app.ts
   ```

3. Open Bot Framework Emulator and connect to:
   - **Endpoint URL:** `http://localhost:3978/api/messages`
   - **App ID:** _(leave blank for local testing)_
   - **App Password:** _(leave blank for local testing)_

### Test Checklist

- [ ] **Bot starts** — Server logs show `⚡ Teams bot running on port 3978`
- [ ] **Health check** — `curl http://localhost:3978/health` returns `{"status":"ok","service":"teams-bot"}`
- [ ] **Echo test** — Send any message, bot replies with echo
- [ ] **Investigation** — Send `investigate payment-service`, bot replies with Adaptive Card
- [ ] **Adaptive Card renders** — Card shows header, FactSet meta, hypothesis, evidence, action buttons
- [ ] **👍 Correct button** — Click it, confirmation message appears
- [ ] **❌ Wrong button** — Click it, bot asks for actual root cause
- [ ] **🔍 Dig deeper button** — Click it, new investigation starts with deeper analysis
- [ ] **Empty message** — Send empty text, bot replies with usage hint
- [ ] **Mention stripping** — Send `<at>OnCallBot</at> check payment-service`, bot strips mention tags

### Azure Deployment Testing

For testing with a real Teams instance:

1. Create Azure App Registration (see `.env.example`)
2. Set `MICROSOFT_APP_ID` and `MICROSOFT_APP_PASSWORD` environment variables
3. Expose the bot via ngrok: `ngrok http 3978`
4. Update Azure Bot messaging endpoint to ngrok URL + `/api/messages`
5. Install the bot in Teams and test @mention in a channel
