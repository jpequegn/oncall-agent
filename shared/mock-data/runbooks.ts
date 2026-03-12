export interface MockRunbook {
  id: string;
  title: string;
  url: string;
  tags: string[];
  applicableServices: string[];
  content: string;
}

export const mockRunbooks: MockRunbook[] = [
  {
    id: "rb-001",
    title: "Null Pointer Exception Triage",
    url: "https://wiki.example.com/runbooks/null-pointer",
    tags: ["error", "java", "go", "npe"],
    applicableServices: ["payment-service", "order-service", "auth-service"],
    content: `## NPE Triage Runbook

### Symptoms
- ERROR logs containing NullPointerException or nil pointer dereference
- Elevated 5xx error rate on affected service
- Specific code path consistently failing

### Investigation Steps
1. Identify the failing code path from stack trace in logs
2. Check recent deployments: \`git log --oneline -10\`
3. Look for newly introduced code paths or config changes
4. Check if the null object is from an external dependency (config, DB, upstream service)

### Common Causes
- Missing null check after config lookup
- New code path not handling optional fields
- Race condition during initialization

### Remediation
- **If recent deploy**: Roll back with \`kubectl rollout undo deployment/<name>\`
- **If config issue**: Update ConfigMap and restart pods
- **If code bug**: Hot-fix, test in staging, fast-track deploy

### Escalation
If NPE persists after rollback, escalate to #platform-oncall.`,
  },
  {
    id: "rb-002",
    title: "Memory Leak Investigation",
    url: "https://wiki.example.com/runbooks/memory-leak",
    tags: ["memory", "performance", "heap", "oom"],
    applicableServices: ["auth-service", "fraud-model-svc", "api-gateway"],
    content: `## Memory Leak Investigation Runbook

### Symptoms
- Pod OOMKilled events: \`kubectl get events | grep OOMKill\`
- Heap usage growing monotonically in Datadog
- GC pause times increasing

### Investigation Steps
1. Check heap metrics: look for sawtooth vs monotonic increase
2. Take heap dump: \`kubectl exec <pod> -- jmap -dump:format=b,file=/tmp/heap.hprof <pid>\`
3. Copy dump: \`kubectl cp <pod>:/tmp/heap.hprof ./heap.hprof\`
4. Analyze with Eclipse Memory Analyzer (MAT)
5. Look for retained objects with large shallow/retained heap

### Common Causes
- Unbounded cache (no eviction policy)
- Event listeners not deregistered
- Long-lived references to short-lived objects
- Library upgrade introducing leak

### Remediation
- Increase memory limit as temporary mitigation
- Identify and fix leak source
- Add heap monitoring alerts

### Escalation
Engage JVM/language expert if leak source not identified within 30 minutes.`,
  },
  {
    id: "rb-003",
    title: "Database Connection Pool Exhaustion",
    url: "https://wiki.example.com/runbooks/connection-pool",
    tags: ["database", "connections", "performance", "pool"],
    applicableServices: ["inventory-service", "payment-service", "order-service", "auth-service"],
    content: `## Connection Pool Exhaustion Runbook

### Symptoms
- Errors: "too many clients already" or "connection pool exhausted"
- High wait times on \`db.connection_pool_wait_time\` metric
- Service latency spike correlating with DB connection metrics

### Diagnosis
\`\`\`sql
-- Check active connections
SELECT count(*), state, wait_event_type, wait_event
FROM pg_stat_activity
WHERE datname = 'your_db'
GROUP BY state, wait_event_type, wait_event;

-- Find long-running queries
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC
LIMIT 20;
\`\`\`

### Immediate Mitigation
1. Kill long-running idle connections: \`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '10 minutes';\`
2. Temporarily increase pool size in config (requires pod restart)
3. Scale up application pods if load-driven

### Root Cause Investigation
- Check for connection leaks (opened but not closed)
- Look for N+1 query patterns
- Review recent code changes to DB access layer

### Long-term Fix
- Implement connection pooler (PgBouncer)
- Add connection timeout + retry logic
- Set statement_timeout`,
  },
  {
    id: "rb-004",
    title: "Slow Query Remediation",
    url: "https://wiki.example.com/runbooks/slow-query",
    tags: ["database", "performance", "query", "index"],
    applicableServices: ["inventory-db", "payment-db", "order-db", "user-db"],
    content: `## Slow Query Remediation Runbook

### Symptoms
- p99 latency spike on database-dependent service
- \`db.query_duration_p99\` metric exceeding SLO (typically > 100ms)
- Elevated CPU on DB host

### Find Slow Queries
\`\`\`sql
-- Enable pg_stat_statements (one-time)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top slow queries
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
\`\`\`

### Analyze Query Plan
\`\`\`sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <your_query>;
\`\`\`

### Common Causes & Fixes
| Symptom in EXPLAIN | Fix |
|---|---|
| Seq Scan on large table | Add index on filter/join column |
| Hash Join with large hash | Ensure statistics are up to date: ANALYZE |
| Nested Loop with many iterations | Rewrite as JOIN or add covering index |

### Add Index (zero-downtime)
\`\`\`sql
CREATE INDEX CONCURRENTLY idx_name ON table(column);
\`\`\`

### Escalation
If query cannot be optimized without schema changes, escalate to DBA team.`,
  },
  {
    id: "rb-005",
    title: "Emergency Deploy Rollback",
    url: "https://wiki.example.com/runbooks/rollback",
    tags: ["deployment", "rollback", "emergency", "incident"],
    applicableServices: ["api-gateway", "auth-service", "payment-service", "order-service", "inventory-service", "fraud-service"],
    content: `## Emergency Deploy Rollback Runbook

### When to Use
- Error rate spike within 30 minutes of a deployment
- P99 latency > 3x baseline after deploy
- NPE or panic appearing in logs post-deploy

### Rollback Steps

#### Kubernetes Rollback (fastest)
\`\`\`bash
# Check rollout history
kubectl rollout history deployment/<service-name>

# Roll back to previous version
kubectl rollout undo deployment/<service-name>

# Monitor rollout
kubectl rollout status deployment/<service-name>
\`\`\`

#### Verify Rollback Success
1. Check pod versions: \`kubectl get pods -l app=<service> -o jsonpath='{.items[*].spec.containers[*].image}'\`
2. Monitor error rate — should return to baseline within 2-3 minutes
3. Check logs for absence of error pattern

### Communication
- Post to #incidents: "Rolling back <service> v<version> due to <symptom>"
- Update incident channel with rollback status
- File post-incident review within 24 hours

### After Rollback
- Tag the bad commit: \`git tag bad-deploy-<date> <sha>\`
- Create hotfix branch from previous stable tag
- Do NOT re-deploy until root cause is understood`,
  },
];
