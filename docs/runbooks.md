# DevRoute Runbooks

Operational procedures for responding to alerts fired by Alertmanager.

---

## api-down

**Alert:** `APIDown`
**Severity:** Critical
**Trigger:** `up{job="devroute-api"} == 0` for 1 minute

### What it means

The Prometheus health check cannot reach the API. The service is either
crashed, OOM-killed, or the ECS task has stopped.

### Steps

1. Check ECS task status:

```bash
   aws ecs describe-services \
     --cluster devroute-prod \
     --services devroute-api \
     --region us-east-1
```

2. Check recent task failures:

```bash
   aws ecs list-tasks \
     --cluster devroute-prod \
     --desired-status STOPPED \
     --region us-east-1
```

3. Check CloudWatch logs for the stopped task:

```bash
   aws logs tail /ecs/devroute-api --follow
```

4. If the task is stopped and not restarting, force a new deployment:

```bash
   aws ecs update-service \
     --cluster devroute-prod \
     --service devroute-api \
     --force-new-deployment \
     --region us-east-1
```

5. If the new deployment also fails, roll back to the previous task definition:

```bash
   aws ecs update-service \
     --cluster devroute-prod \
     --service devroute-api \
     --task-definition devroute-api:PREVIOUS \
     --region us-east-1
```

### Common causes

- Out of memory: increase `task_memory` in Terraform ECS module
- Bad deployment: roll back using step 5 above
- RDS unreachable: check RDS security group and subnet routing

---

## high-error-rate

**Alert:** `HighErrorRate`
**Severity:** Warning
**Trigger:** 5xx error rate > 5% over 5 minutes

### What it means

More than 1 in 20 requests are returning server errors. This could be
a bad deployment, a database issue, or a dependency failure.

### Steps

1. Check which endpoints are erroring (Grafana - Request Rate by status_code panel)

2. Check API logs for stack traces:

```bash
   aws logs tail /ecs/devroute-api --follow \
     --filter-pattern "ERROR"
```

3. Check database connectivity from the running task:

```bash
   aws ecs execute-command \
     --cluster devroute-prod \
     --task <task-id> \
     --container devroute-api \
     --command "node -e \"require('./src/db/postgres').query('SELECT 1')\""
```

4. Check RDS metrics in CloudWatch for high CPU or connection exhaustion

5. If errors started after a deployment, roll back:

```bash
   aws ecs update-service \
     --cluster devroute-prod \
     --service devroute-api \
     --task-definition devroute-api:PREVIOUS \
     --region us-east-1
```

### Common causes

- Database connection pool exhausted: check `DB_POOL_MAX` env var
- Bad code deployment: roll back
- RDS CPU spike: check for missing indexes or slow queries

---

## high-latency

**Alert:** `HighLatency`
**Severity:** Warning
**Trigger:** p95 latency > 1 second over 5 minutes

### What it means

95% of requests are completing within the threshold, but the slowest
5% are taking over 1 second. Usually a database or cache issue.

### Steps

1. Check the Latency Percentiles panel in Grafana - is p50 also high,
   or only p95/p99? If only p99, it is likely a single slow query.

2. Check cache hit rate - if it dropped, DB load increases:

```bash
   # Check Redis connectivity
   aws ecs execute-command \
     --cluster devroute-prod \
     --task <task-id> \
     --container devroute-api \
     --command "node -e \"require('./src/cache/redis').getLink('test')\""
```

3. Check RDS slow query logs in CloudWatch.
   Log group: `/aws/rds/instance/devroute-prod/slowquery`

4. Check ECS task CPU - if it is pegged at 100%, the task is
   CPU-starved. Increase `task_cpu` in Terraform.

### Common causes

- Redis down: API falls back to DB for every request, increasing load
- Missing DB index: a new query pattern hitting a sequential scan
- Task CPU throttling: increase Fargate CPU allocation

---

## low-cache-hit-rate

**Alert:** `LowCacheHitRate`
**Severity:** Warning
**Trigger:** Cache hit rate < 50% over 10 minutes

### What it means

More than half of link lookups are missing the Redis cache and falling
through to PostgreSQL. This increases DB load and latency.

### Steps

1. Check if Redis is reachable:

```bash
   aws logs tail /ecs/devroute-api --follow \
     --filter-pattern "Redis"
```

2. Check Redis memory usage - if maxmemory is hit, Redis evicts keys:

```bash
   redis-cli -u $REDIS_URL info memory | grep used_memory_human
```

3. Check if a deployment cleared the cache - alert will auto-resolve
   within 10-15 minutes as cache warms up after a deploy.

4. If Redis is down, the API degrades gracefully to DB-only mode.
   Restart the Redis service or provision a new ElastiCache cluster.

### Common causes

- Redis restarted: cache is cold, will warm up automatically
- Redis out of memory: increase ElastiCache node size
- TTL set too low: increase `setLink` TTL in `src/cache/redis.js`

---

## General commands

```bash
# View all ECS services
aws ecs list-services --cluster devroute-prod

# SSH into a running Fargate task (requires ECS Exec enabled)
aws ecs execute-command \
  --cluster devroute-prod \
  --task <task-id> \
  --container devroute-api \
  --interactive \
  --command "/bin/sh"

# View Prometheus targets
curl http://localhost:9090/api/v1/targets | jq .

# Reload Alertmanager config without restart
curl -X POST http://localhost:9093/-/reload
```
