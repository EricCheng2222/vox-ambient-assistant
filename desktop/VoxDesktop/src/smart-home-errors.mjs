/** Adapters distinguish recoverable transport faults from credentials and uncertain writes. */
export class SmartHomeConnectionError extends Error {
  constructor(message, { kind = "connection", retryable = true, retrySafe = true, cause } = {}) {
    super(message, { cause });
    this.name = "SmartHomeConnectionError";
    this.kind = kind;
    this.retryable = retryable;
    this.retrySafe = retrySafe;
  }
}
