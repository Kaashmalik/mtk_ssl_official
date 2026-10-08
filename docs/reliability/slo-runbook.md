# SLOs/SLIs Definition & Operational Incident Runbooks

This document defines the platform's reliability targets (SLIs/SLOs) and details step-by-step instructions for resolving active prometheus alerts.

---

## 1. SERVICE LEVEL OBJECTIVES (SLOs) & INDICATORS (SLIs)

| Service Area | Service Level Indicator (SLI) | Service Level Objective (SLO) | Target |
|--------------|------------------------------|-------------------------------|--------|
| **API Gateway** | Ratio of non-5xx HTTP responses to total requests over 30 days. | Gateway Availability | **≥ 99.9%** |
| **API Gateway** | Ratio of requests processed in < 200ms to total HTTP requests. | Gateway Latency | **≥ 95%** |
| **Scoring WebSockets** | Ratio of successful WebSockets connects/broadcasts to total attempts. | Scoring Availability | **≥ 99.95%** |
| **Scoring WebSockets** | Processing delay from ball event submission to client push. | Scoring Event Lag | **< 2.0s** |
| **Payments Integration** | Ratio of successful checkout sessions to total payment attempts. | Payment Success Rate | **≥ 99.0%** |

---

## 2. INCIDENT RUNBOOKS

### Alert 1: `HighErrorRate` (5xx > 1%)
**Symptoms**: Users receive HTTP 500 status codes, client apps show retry banners.
**Step-by-step resolution**:
1. Identify the affected service from the Prometheus label:
   ```bash
   kubectl get pods -n ssl-gateway -l app=api-gateway
   ```
2. Search Sentry issues dashboard for recent HTTP 5xx exceptions or database transaction errors.
3. Check the affected pod logs using Pino structured log outputs:
   ```bash
   kubectl logs deployment/api -n ssl-api --tail=100 --prefix
   ```
4. If related to DB connectivity, check PostgreSQL status (see Alert 4).
5. If a bad release is suspected, perform an instant roll-back:
   ```bash
   kubectl rollout undo deployment/api -n ssl-api
   ```

---

### Alert 2: `HighLatency` (p95 > 2s)
**Symptoms**: Web pages/mobile apps load slowly; API Gateway shows timeout responses.
**Step-by-step resolution**:
1. Check CPU and memory usage of the running microservices:
   ```bash
   kubectl top pods --all-namespaces
   ```
2. Check Redis response times and connections:
   ```bash
   redis-cli -u $REDIS_URL ping
   ```
3. Inspect active queries on PostgreSQL:
   ```sql
   SELECT pid, age(clock_timestamp(), query_start), usename, query 
   FROM pg_stat_activity 
   WHERE state != 'idle' AND age(clock_timestamp(), query_start) > interval '2 seconds';
   ```
4. Kill any rogue lock/long-running queries:
   ```sql
   SELECT pg_cancel_backend(pid);
   ```

---

### Alert 3: `TenantQuotaExceeded`
**Symptoms**: Specific tenant users receive HTTP 429 "Too Many Requests" responses.
**Step-by-step resolution**:
1. Check the Prometheus metric to identify the target tenant:
   ```promql
   sum(rate(ssl_tenant_quota_violations_total[5m])) by (tenant)
   ```
2. Check if this is normal usage increase or an active DDoS/scraping attack.
3. If it is a legitimate high-profile league tournament day, increase their limit in the database or config:
   - Edit the tenant limit via Admin Panel -> Feature Flags / Quotas.
   - Or increase the global default env limit: `TENANT_QUOTA_MAX_REQUESTS`.

---

### Alert 4: `DatabaseConnectionPoolExhausted` (Usage > 90%)
**Symptoms**: API connections throw `ServiceUnavailableException` (DB pool timed out).
**Step-by-step resolution**:
1. Check active database connection count:
   ```bash
   pg_isready -h $DB_HOST -p 5432
   ```
2. Temporarily scale down microservices replicas to drop active connections:
   ```bash
   kubectl scale deployment/api -n ssl-api --replicas=1
   ```
3. Update connection pool sizes in the environment configuration:
   - Decrease `dbConnectionLimit` / `maxConnections` in Drizzle clients to let pgPool handle it.
   - Increase `max_connections` inside PostgreSQL parameters in Cloud SQL.
4. Scale services back up.
