/**
 * Shared TypeScript types and interfaces for QueueCTL.
 */

/** Valid states a job can be in throughout its lifecycle. */
export type JobState = 'pending' | 'processing' | 'completed' | 'failed' | 'dead';

/** Valid statuses for a worker process. */
export type WorkerStatus = 'idle' | 'busy' | 'stopping' | 'stopped';

/** Represents a job row in the SQLite database. */
export interface Job {
  id: string;
  command: string;
  state: JobState;
  attempts: number;
  max_retries: number;
  priority: number;
  run_at: string | null;
  next_attempt_at: string | null;
  timeout_seconds: number | null;
  worker_id: string | null;
  locked_at: string | null;
  last_error: string | null;
  stdout: string | null;
  stderr: string | null;
  exit_code: number | null;
  created_at: string;
  updated_at: string;
}

/** Represents a worker row in the SQLite database. */
export interface WorkerInfo {
  worker_id: string;
  pid: number;
  status: WorkerStatus;
  current_job_id: string | null;
  started_at: string;
  last_heartbeat: string;
}

/** Result of executing a job's shell command. */
export interface ExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

/** Counts of jobs grouped by state. */
export interface JobCounts {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead: number;
}

/** Extended queue metrics including success rate and timing. */
export interface QueueMetrics {
  counts: JobCounts;
  avgExecutionTimeMs: number | null;
  successRate: number | null;
  totalProcessed: number;
}

/** IPC message types for parent ↔ worker process communication. */
export type WorkerIPCMessage =
  | { type: 'started'; workerId: string; pid: number }
  | { type: 'stopped'; workerId: string }
  | { type: 'heartbeat'; workerId: string }
  | { type: 'stop' }
  | { type: 'stop-force' };

/** Configuration keys that can be set via the config CLI command. */
export type ConfigKey =
  | 'max-retries'
  | 'backoff-base'
  | 'poll-interval-ms'
  | 'stale-timeout-s'
  | 'default-timeout-s';

/** Default configuration values. */
export const CONFIG_DEFAULTS: Record<ConfigKey, string> = {
  'max-retries': '3',
  'backoff-base': '2',
  'poll-interval-ms': '500',
  'stale-timeout-s': '60',
  'default-timeout-s': '30',
};
