# QueueCTL Self-Audit Table

This table verifies that every requirement from the assignment brief (plus the additional prompt constraints) has been successfully fulfilled, pointing precisely to where the logic resides in the codebase.

| Requirement | Status | File Path & Implementation Details |
| :--- | :---: | :--- |
| **Language & Architecture** |
| CLI Interface | ✅ | `src/index.ts` & `src/cli/*.ts`. Uses `commander` for routing and parsing. |
| Supported Tech Stack | ✅ | Implemented in **TypeScript / Node.js** (`package.json`, `tsconfig.json`). |
| Data Persistence (across restarts) | ✅ | SQLite 3 via `better-sqlite3`. Defined in `src/core/db.ts` (WAL mode enabled). |
| Docker is source of truth for demo | ✅ | Provided `Dockerfile` and `docker-compose.yml`. Documented in `README.md`. |
| Windows native dev support | ✅ | Shell execution in `src/core/executor.ts` runs natively on Windows (no hardcoded `/bin/sh`). |
| Database file location | ✅ | Defaults to `./queuectl.db` in CWD, overridable by `QUEUECTL_DB_PATH`. See `src/core/db.ts`. |
| Shebang line persistence | ✅ | `src/index.ts` starts with `#!/usr/bin/env node` and `package.json` maps `bin` to `dist/index.js`. |
| **Job Specification** |
| `id` (unique-job-id) | ✅ | Auto-generated UUID (`crypto.randomUUID()`) or custom ID. See `src/core/jobRepository.ts:insertJob`. |
| `command` (echo, curl, etc.) | ✅ | `jobs` table `command` column. Stored securely and executed via `child_process.exec`. |
| `state` | ✅ | `pending`, `processing`, `completed`, `failed`, `dead`. `idx_jobs_state` index created. |
| `attempts` & `max_retries` | ✅ | Handled in `src/core/jobRepository.ts:failJob`. Default `max_retries` is 3 (from config). |
| `run_at` (Scheduling) | ✅ | Job claim query filters by `run_at IS NULL OR run_at <= datetime('now')`. See `jobRepository.ts:claimJob`. |
| `priority` (Higher runs first) | ✅ | Query uses `ORDER BY priority DESC, created_at ASC`. Index `idx_jobs_priority` optimizes this. |
| **Core Functions (Commands)** |
| `queuectl enqueue <command>` | ✅ | Implemented in `src/cli/enqueue.ts`. Allows single or bulk insert (`--file`). |
| `queuectl worker start --count N` | ✅ | `src/cli/worker.ts` forks `N` child processes (`child_process.fork('.../workerProcess.js')`). |
| `queuectl worker stop` | ✅ | Sends `stop` IPC message to workers for graceful exit. `--timeout` triggers `stop-force`. |
| `queuectl status` | ✅ | `src/cli/status.ts` calls `getJobCounts` and `getMetrics`, showing aggregated state. |
| **Background Processing & Resilience** |
| Run Jobs Concurrently (Multiple Workers) | ✅ | Workers run in separate OS processes. Validated in integration tests (`scenarios.test.ts`). |
| Ensure no job is executed twice | ✅ | `UPDATE ... WHERE id = (SELECT ...)` atomic query in `src/core/jobRepository.ts:claimJob` guarantees this. |
| Wait / Poll for new jobs | ✅ | Main loop in `src/worker/workerProcess.ts` polls every `poll-interval-ms` (default 500ms). |
| Capture standard output / error | ✅ | `src/core/executor.ts` extracts `stdout` and `stderr` from `exec` and saves to DB. |
| Handle Job Failures & Retries | ✅ | Extracted exit codes map to `failed` state and increment `attempts`. See `failJob()`. |
| **Retry & Dead Letter Queue (DLQ)** |
| Exponential Backoff Formula | ✅ | `delay = base^attempts`. Computed in `src/core/backoff.ts`. Next run tracked via `next_attempt_at`. |
| Configurable max retries & backoff base | ✅ | `config` table stores these. Defaults seeded in `src/core/config.ts`. Modified via `queuectl config set`. |
| Dead Letter Queue (DLQ) | ✅ | Jobs move to `dead` state when `attempts >= max_retries`. Handled natively in `jobRepository.ts`. |
| `queuectl dlq list` & `retry` | ✅ | Implemented in `src/cli/dlq.ts`. `retry` resets state to `pending` and `attempts` to 0. |
| **Bonus Features / Enhancements** |
| Job Output Logging | ✅ | Captured during execution. Displayed cleanly in `queuectl logs <job-id>`. |
| Job Timeout Handling | ✅ | Configurable `timeout_seconds`. Enforced via `exec`'s built-in `timeout` property. |
| Scheduled / Delayed Jobs | ✅ | `--run-at <timestamp>` param mapped to `run_at` column. |
| Web Dashboard | ✅ | Minimal Express dashboard served via `queuectl dashboard --port 3000`. |
| **Testing & Verification** |
| Unit and Integration Tests | ✅ | Written using `vitest`. Covers backoff logic, concurrent workers, failures, and DLQ (`tests/`). |
| Bash & PowerShell Verification Scripts | ✅ | `scripts/verify.sh` & `scripts/verify.ps1` execute the 5 core scenarios end-to-end. |
