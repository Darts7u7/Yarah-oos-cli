# `yarah diagnose` — SRE Diagnostic Command

## Overview

Add a top-level `yarah diagnose` command group that aggregates backend health data from multiple sources (EC2 metrics, advisor scans, database diagnostics, logs) into a unified CLI experience. Helps developers quickly understand the state of their Yarah backend and troubleshoot issues.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Output modes | CLI + Agent dual-mode (`--json`) | Reuses existing `--json` convention; zero extra cost |
| Unavailable data sources | Skip and mark N/A | Diagnostic tools should show what they can, not fail |
| DB SQL execution mode | Always unrestricted | Diagnostic SQLs are read-only system view queries |
| MCP tool integration | Out of scope | Lives in a separate repo; CLI only for now |
| Command name | `diagnose` | Clear SRE semantics, no conflict with existing commands |
| Architecture | Flat subcommands | Matches existing CLI patterns (db, functions, storage) |
| Advisor history/resolve | Deferred | Not in initial scope |
| OSS mode (`--api-key` link) | Skip metrics/advisor, DB+logs only | No Platform API access in OSS mode |

## Commands

### `yarah diagnose`

Comprehensive health report. Fetches all 4 data sources in parallel via `Promise.allSettled`. Unavailable modules render as N/A with reason.

**Parameters:** None (inherits global `--json`).

**Hardcoded defaults for summary:** metrics uses `range=1h` (all metrics), advisor uses latest scan, db runs all checks, logs uses `limit=100` per source.

**Output (table mode):**

```
┌─────────────────────────────────────────────────┐
│  Yarah Health Report — {project_name}        │
├─────────────────────────────────────────────────┤
│  System Metrics (last 1h)                       │
│    CPU: 23.4%   Memory: 67.8%                   │
│    Disk: 42.1%  Network: ↑12KB/s ↓5.7KB/s      │
├─────────────────────────────────────────────────┤
│  Advisor Scan ({date})                          │
│    1 critical · 3 warning · 1 info              │
├─────────────────────────────────────────────────┤
│  Database                                       │
│    Connections: 12/100  Cache Hit: 98.7%        │
│    Dead tuples: 2,060   Locks waiting: 0        │
├─────────────────────────────────────────────────┤
│  Recent Errors (last 100 logs per source)       │
│    yarah.logs: 0  postgREST.logs: 2          │
│    postgres.logs: 0  function.logs: 1           │
└─────────────────────────────────────────────────┘
```

**JSON mode:** `{ metrics: {...} | null, advisor: {...} | null, db: {...} | null, logs: {...} | null, errors: ["EC2 monitoring not enabled"] }`

### `yarah diagnose metrics`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--range` | `1h\|6h\|24h\|7d` | `1h` | Time range |
| `--metrics` | string | all | Comma-separated: `cpu_usage,memory_usage,disk_usage,network_in,network_out` |

**API:** `GET /projects/v1/:projectId/metrics?range={range}&metrics={metrics}`

**Output (table mode):**

```
  Metric       │ Latest    │ Avg       │ Max       │ Range
───────────────┼───────────┼───────────┼───────────┼────────
  CPU Usage    │ 23.4%     │ 18.7%     │ 45.2%     │ 6h
  Memory Usage │ 67.8%     │ 65.1%     │ 72.3%     │ 6h
  Disk Usage   │ 42.1%     │ 41.9%     │ 42.5%     │ 6h
  Network In   │ 12.3 KB/s │ 8.1 KB/s  │ 45.6 KB/s │ 6h
  Network Out  │ 5.7 KB/s  │ 4.2 KB/s  │ 21.3 KB/s │ 6h
```

Latest = last data point. Avg/Max computed from `MetricSeries.data[]`. Network values (bytes/sec) auto-scaled to B/KB/MB.

**JSON mode:** API response augmented with computed `latest`, `avg`, `max` per metric.

### `yarah diagnose advisor`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--severity` | `critical\|warning\|info` | all | Filter by severity |
| `--category` | `security\|performance\|health` | all | Filter by category |
| `--limit` | number | 50 | Max issues returned |

**API:**
1. `GET /projects/v1/:projectId/advisor/latest` — scan summary
2. `GET /projects/v1/:projectId/advisor/latest/issues?severity={s}&category={c}&limit={n}` — issue list

**Output (table mode):**

```
  Scan: 2026-03-24 (completed) — 1 critical, 3 warning, 1 info

  Severity │ Category    │ Affected Object        │ Title
──────────┼─────────────┼────────────────────────┼──────────────────────────
  critical │ security    │ public.user_profiles   │ Table publicly accessible
  warning  │ performance │ public.orders          │ Missing index on foreign key
  ...
```

**JSON mode:** `{ scan: AdvisorScanSummary, issues: AdvisorIssue[] }`

### `yarah diagnose db`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--check` | string | `all` | Comma-separated checks: `connections,slow-queries,bloat,size,index-usage,locks,cache-hit` |

**API:** `POST /api/database/advance/rawsql` (unrestricted mode) for each check.

**Predefined SQL checks:**

| Check | SQL |
|-------|-----|
| `connections` | `SELECT count(*) AS active FROM pg_stat_activity WHERE state IS NOT NULL` combined with `SHOW max_connections` |
| `slow-queries` | `SELECT pid, now()-query_start AS duration, query FROM pg_stat_activity WHERE state='active' AND now()-query_start > interval '5 seconds'` |
| `bloat` | `SELECT schemaname, relname, n_dead_tup FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10` |
| `size` | `SELECT schemaname, relname, pg_size_pretty(pg_total_relation_size(relid)) AS size FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10` |
| `index-usage` | `SELECT relname, idx_scan, seq_scan, CASE WHEN (idx_scan+seq_scan)>0 THEN round(100.0*idx_scan/(idx_scan+seq_scan),1) ELSE 0 END AS idx_ratio FROM pg_stat_user_tables WHERE (idx_scan+seq_scan)>0 ORDER BY idx_ratio ASC LIMIT 10` |
| `locks` | `SELECT pid, mode, relation::regclass, granted FROM pg_locks WHERE NOT granted` |
| `cache-hit` | `SELECT CASE WHEN sum(heap_blks_hit+heap_blks_read)>0 THEN round(100.0*sum(heap_blks_hit)/sum(heap_blks_hit+heap_blks_read),1) ELSE 0 END AS ratio FROM pg_statio_user_tables` |

**Output (table mode):** Each check rendered as a labeled section with table or single-value display. See Design Part 2 for detailed format.

**JSON mode:** `{ connections: {...}, slow_queries: [...], bloat: [...], size: [...], index_usage: [...], locks: [...], cache_hit: {...} }`

### `yarah diagnose logs`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--source` | string | all 4 sources | Log source name |
| `--limit` | number | 100 | Entries per source |

**Log sources:** `yarah.logs`, `postgREST.logs`, `postgres.logs`, `function.logs`

**API:** `GET /api/logs/{source}?limit={n}` for each source.

**Error filtering:** Client-side keyword match on `ERROR`, `FATAL`, `error`, `panic` (case-insensitive).

**Output (table mode):**

Summary table showing total/error/fatal counts per source, followed by error detail entries with timestamp and message.

**JSON mode:** `{ sources: [{ source: string, total: number, errors: LogEntry[], fatals: LogEntry[] }] }`

## File Structure

```
src/commands/diagnose/
├── index.ts              # registerDiagnoseCommands() + comprehensive report
├── metrics.ts            # diagnose metrics
├── advisor.ts            # diagnose advisor
├── db.ts                 # diagnose db (predefined SQL checks)
└── logs.ts               # diagnose logs (error aggregation)
```

## Implementation Details

### Command Registration

In `src/index.ts`:
```typescript
const diagnoseCmd = program.command('diagnose');
registerDiagnoseCommands(diagnoseCmd);
```

### API Communication

- **metrics, advisor** — `platformFetch()` (Platform API, bearer token auth)
- **db, logs** — `ossFetch()` (OSS API, appkey + api_key auth)

No new API client methods needed. Direct calls to `platformFetch`/`ossFetch` within command files, consistent with existing `db query` and `logs` commands.

### Comprehensive Report Orchestration

```typescript
const [metrics, advisor, db, logs] = await Promise.allSettled([
  fetchMetricsSummary(projectId),
  fetchAdvisorSummary(projectId),
  runDbChecks(projectId),
  fetchLogsSummary(projectId),
]);
// fulfilled → render section, rejected → render N/A with reason
```

### DB Checks Registry

```typescript
const DB_CHECKS: Record<string, { label: string; sql: string; format: (rows: any[]) => string }> = {
  connections: { label: 'Connections', sql: '...', format: ... },
  'slow-queries': { ... },
  // ...
};
```

`--check all` iterates all entries; otherwise only specified checks. Each SQL executed independently via `ossFetch` rawsql endpoint.

### Error Handling

Follows existing CLI patterns:
- `requireAuth()` + project config check as preconditions
- `handleError(err, json)` for standardized error output
- `reportCliUsage('cli.diagnose.*', success)` for analytics

### Logs Error Filtering

Reuses existing `logs` command's log parsing logic. Fetches raw logs per source, then filters client-side by error-level keywords (`ERROR`, `FATAL`, `error`, `panic`).
