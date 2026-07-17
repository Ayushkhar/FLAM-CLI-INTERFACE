

export class QueueCtlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class JobExecutionError extends QueueCtlError {
  constructor(
    message: string,
    public readonly jobId: string,
    public readonly exitCode: number | null = null,
  ) {
    super(message);
  }
}

export class JobClaimError extends QueueCtlError {
  constructor(
    message: string,
    public readonly workerId: string,
  ) {
    super(message);
  }
}

export class ConfigValidationError extends QueueCtlError {
  constructor(
    message: string,
    public readonly key: string,
    public readonly value: string,
  ) {
    super(message);
  }
}

export class WorkerError extends QueueCtlError {
  constructor(
    message: string,
    public readonly workerId?: string,
  ) {
    super(message);
  }
}

export class DatabaseError extends QueueCtlError {
  constructor(
    message: string,
    public readonly operation: string,
  ) {
    super(message);
  }
}

export class ValidationError extends QueueCtlError {
  constructor(
    message: string,
    public readonly errors: string[],
  ) {
    super(message);
  }
}
