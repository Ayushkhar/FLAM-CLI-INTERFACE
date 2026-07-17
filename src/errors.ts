/**
 * Custom error classes for QueueCTL.
 * Using typed errors instead of raw strings enables structured error handling
 * and cleaner error messages throughout the system.
 */

/** Base error class for all QueueCTL errors. */
export class QueueCtlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (required for instanceof checks with TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a job's shell command execution fails unexpectedly. */
export class JobExecutionError extends QueueCtlError {
  constructor(
    message: string,
    public readonly jobId: string,
    public readonly exitCode: number | null = null,
  ) {
    super(message);
  }
}

/** Thrown when the atomic job claim operation encounters an issue. */
export class JobClaimError extends QueueCtlError {
  constructor(
    message: string,
    public readonly workerId: string,
  ) {
    super(message);
  }
}

/** Thrown when a configuration value fails validation. */
export class ConfigValidationError extends QueueCtlError {
  constructor(
    message: string,
    public readonly key: string,
    public readonly value: string,
  ) {
    super(message);
  }
}

/** Thrown when a worker process encounters an operational error. */
export class WorkerError extends QueueCtlError {
  constructor(
    message: string,
    public readonly workerId?: string,
  ) {
    super(message);
  }
}

/** Thrown when a database operation fails. */
export class DatabaseError extends QueueCtlError {
  constructor(
    message: string,
    public readonly operation: string,
  ) {
    super(message);
  }
}

/** Thrown when an enqueue payload fails zod validation. */
export class ValidationError extends QueueCtlError {
  constructor(
    message: string,
    public readonly errors: string[],
  ) {
    super(message);
  }
}
