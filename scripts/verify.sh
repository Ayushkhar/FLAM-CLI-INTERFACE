#!/bin/bash
set -e

# Setup temp DB
export QUEUECTL_DB_PATH="/tmp/queuectl-test-$$/queuectl.db"
mkdir -p "/tmp/queuectl-test-$$"
QUEUECTL="node $(pwd)/dist/index.js"

echo "Running queuectl smoke tests..."
$QUEUECTL config set max-retries 2

echo "Scenario 1: Basic success"
$QUEUECTL enqueue '{"command":"echo hello_world", "id": "job-1"}'
$QUEUECTL worker start --count 1
sleep 2
$QUEUECTL worker stop --force
STATUS=$($QUEUECTL status --json)
if ! echo "$STATUS" | grep -q '"completed": 1'; then
  echo "❌ Scenario 1 failed"
  exit 1
fi
echo "✅ Scenario 1 passed"

echo "Scenario 2: Retry -> backoff -> DLQ"
$QUEUECTL enqueue '{"command":"exit 1", "id": "job-2", "max_retries": 2}'
$QUEUECTL worker start --count 1
sleep 4
$QUEUECTL worker stop --force
STATUS=$($QUEUECTL status --json)
if ! echo "$STATUS" | grep -q '"dead": 1'; then
  echo "❌ Scenario 2 failed"
  exit 1
fi
echo "✅ Scenario 2 passed"

echo "Scenario 3: Concurrent workers, no duplicates"
LOG_FILE="/tmp/queuectl-test-$$/concurrency.log"
rm -f "$LOG_FILE"
for i in {1..5}; do
  $QUEUECTL enqueue "{\"command\":\"echo job-$i >> $LOG_FILE\", \"id\": \"cjob-$i\"}"
done
$QUEUECTL worker start --count 3
sleep 3
$QUEUECTL worker stop --force
if [ $(wc -l < "$LOG_FILE") -ne 5 ]; then
  echo "❌ Scenario 3 failed"
  exit 1
fi
echo "✅ Scenario 3 passed"

echo "Scenario 4: Invalid command fails gracefully"
$QUEUECTL enqueue '{"command":"nonexistent_cmd_123", "id": "job-4", "max_retries": 1}'
$QUEUECTL worker start --count 1
sleep 2
$QUEUECTL worker stop --force
STATUS=$($QUEUECTL status --json)
if ! echo "$STATUS" | grep -q '"dead": 2'; then
  echo "❌ Scenario 4 failed"
  exit 1
fi
echo "✅ Scenario 4 passed"

echo "Scenario 5: Restart survives"
$QUEUECTL enqueue '{"command":"echo survive", "id": "job-5"}'
STATUS=$($QUEUECTL status --json)
if ! echo "$STATUS" | grep -q '"pending": 1'; then
  echo "❌ Scenario 5 failed"
  exit 1
fi
echo "✅ Scenario 5 passed"

# Cleanup
rm -rf "/tmp/queuectl-test-$$"
echo "All tests passed! ✅"
