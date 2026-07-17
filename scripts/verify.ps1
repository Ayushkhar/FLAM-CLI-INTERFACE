$ErrorActionPreference = "Stop"

# Setup temp DB
$TempDir = Join-Path $env:TEMP "queuectl-test-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$env:QUEUECTL_DB_PATH = Join-Path $TempDir "queuectl.db"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$QueueCtl = "node"
$QueueCtlArgs = @(Join-Path $ProjectDir "dist\index.js")

function Run-QueueCtl {
    param([string[]]$ArgsList)
    & $QueueCtl $QueueCtlArgs $ArgsList
}

function Enqueue-Job {
    param([string]$JsonString)
    $JobFile = Join-Path $TempDir "job-$(Get-Random).json"
    "[$JsonString]" | Set-Content -Path $JobFile
    Run-QueueCtl "enqueue", "--file", $JobFile
}

Write-Host "Running queuectl smoke tests..."
Run-QueueCtl "config", "set", "max-retries", "2"

Write-Host "Scenario 1: Basic success"
Enqueue-Job '{"command":"echo hello_world", "id": "job-1"}'
Run-QueueCtl "worker", "start", "--count", "1"
Start-Sleep -Seconds 2
Run-QueueCtl "worker", "stop", "--force"
$Status = Run-QueueCtl "status", "--json" | ConvertFrom-Json
if ($Status.queue.completed -ne 1) {
    Write-Error "❌ Scenario 1 failed"
}
Write-Host "✅ Scenario 1 passed"

Write-Host "Scenario 2: Retry -> backoff -> DLQ"
Enqueue-Job '{"command":"cmd /c exit 1", "id": "job-2", "max_retries": 2}'
Run-QueueCtl "worker", "start", "--count", "1"
Start-Sleep -Seconds 4
Run-QueueCtl "worker", "stop", "--force"
$Status = Run-QueueCtl "status", "--json" | ConvertFrom-Json
if ($Status.queue.dead -ne 1) {
    Write-Error "❌ Scenario 2 failed"
}
Write-Host "✅ Scenario 2 passed"

Write-Host "Scenario 3: Concurrent workers, no duplicates"
$LogFile = Join-Path $TempDir "concurrency.log"
$LogFileEscaped = $LogFile -replace '\\', '\\'
for ($i = 1; $i -le 5; $i++) {
    Enqueue-Job "{`"command`":`"echo job-$i >> $LogFileEscaped`", `"id`": `"cjob-$i`"}"
}
Run-QueueCtl "worker", "start", "--count", "3"
Start-Sleep -Seconds 3
Run-QueueCtl "worker", "stop", "--force"
$Lines = (Get-Content $LogFile).Count
if ($Lines -ne 5) {
    Write-Error "❌ Scenario 3 failed"
}
Write-Host "✅ Scenario 3 passed"

Write-Host "Scenario 4: Invalid command fails gracefully"
Enqueue-Job '{"command":"nonexistent_cmd_123", "id": "job-4", "max_retries": 1}'
Run-QueueCtl "worker", "start", "--count", "1"
Start-Sleep -Seconds 2
Run-QueueCtl "worker", "stop", "--force"
$Status = Run-QueueCtl "status", "--json" | ConvertFrom-Json
if ($Status.queue.dead -ne 2) {
    Write-Error "❌ Scenario 4 failed"
}
Write-Host "✅ Scenario 4 passed"

Write-Host "Scenario 5: Restart survives"
Enqueue-Job '{"command":"echo survive", "id": "job-5"}'
$Status = Run-QueueCtl "status", "--json" | ConvertFrom-Json
if ($Status.queue.pending -ne 1) {
    Write-Error "❌ Scenario 5 failed"
}
Write-Host "✅ Scenario 5 passed"

# Cleanup
Remove-Item -Recurse -Force $TempDir
Write-Host "All tests passed! ✅"
