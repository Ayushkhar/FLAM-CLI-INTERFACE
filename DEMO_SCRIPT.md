# Demo Script for QueueCTL

*Follow this script exactly while recording the demo video.*

---

## 1. Preparation
Ensure you are in the project root and have built the project (`npm run build`). Use `docker compose up -d` to run the environment or run commands natively via Node.

## 2. Help & CLI Structure
Show the CLI interface:
```bash
node dist/index.js --help
```

## 3. Configuration Management
Show that configuration is dynamic, not hardcoded:
```bash
node dist/index.js config list
node dist/index.js config set max-retries 3
node dist/index.js config list
```

## 4. Enqueueing Jobs
Queue up a variety of jobs to show different capabilities:
```bash
# Basic success
node dist/index.js enqueue '{"command":"echo hello queue"}'

# Will fail and trigger retries
node dist/index.js enqueue '{"command":"exit 1"}'

# Priority job (will jump the line)
node dist/index.js enqueue '{"command":"echo high priority"}' --priority 10

# Delayed job (won't run immediately)
node dist/index.js enqueue '{"command":"echo future"}' --run-at 2030-01-01T00:00:00Z
```

## 5. Initial Status
Show the queue before workers start:
```bash
node dist/index.js status
```
*Notice 4 pending jobs and 0 active workers.*

## 6. Starting Workers
Spin up 3 concurrent worker processes:
```bash
node dist/index.js worker start --count 3
```

## 7. Live Monitoring
Wait 5-10 seconds, then check status again:
```bash
node dist/index.js status
```
*Notice jobs moving to completed/failed, workers shown as active/idle with PIDs.*

## 8. Verifying Completion & Logs
List completed jobs to find the ID of the 'hello queue' or priority job:
```bash
node dist/index.js list --state completed
```
Copy the ID of one completed job, then view its captured stdout:
```bash
node dist/index.js logs <paste-job-id>
```

## 9. Dead Letter Queue (DLQ)
Wait enough time for the `exit 1` job to exhaust its 3 retries (base^attempts backoff = 2+4+8s = ~14 seconds).
```bash
node dist/index.js dlq list
```
*Show that the job permanently failed and moved to the DLQ.*

Retry the dead job:
```bash
node dist/index.js dlq retry --all
node dist/index.js status
```
*Show that it moved back to pending and was immediately picked up by a worker.*

## 10. Crash Recovery (Stale-lock Reaper)
Find a worker PID from the status output and kill it forcefully:
```bash
node dist/index.js status
# Note a PID of a running worker, e.g., 12345
kill -9 12345 # Or taskkill /F /PID 12345 on Windows
```
*Explain that the reaper running in the other active workers will detect the dead worker's heartbeat stopped and reclaim its job.*

## 11. Graceful Shutdown
Stop the remaining workers cleanly:
```bash
node dist/index.js worker stop
```
*Show that it waits for in-flight jobs to finish before exiting.*

## 12. Persistence
Show that even though workers are stopped, data survived:
```bash
node dist/index.js status
```

## 13. Bonus: Web Dashboard
Start the real-time UI:
```bash
node dist/index.js dashboard --port 3000
```
Open a browser to `http://localhost:3000`. Show the live auto-updating stats.
