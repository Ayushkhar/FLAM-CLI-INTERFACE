/**
 * Exponential backoff calculation.
 *
 * Formula: delay = base ^ attempts (seconds)
 * This is the exact formula specified in the assignment.
 *
 * Examples with default base=2:
 *   attempt 1 → 2^1 = 2s
 *   attempt 2 → 2^2 = 4s
 *   attempt 3 → 2^3 = 8s
 */

/**
 * Computes the backoff delay in seconds.
 * @param attempts - Number of attempts consumed so far (1-based after increment)
 * @param base - Exponential base (default: 2, configurable via config table)
 * @returns Delay in seconds before the next retry
 */
export function computeBackoffDelay(attempts: number, base: number): number {
  return Math.pow(base, attempts);
}

/**
 * Computes the ISO timestamp for when the next attempt should happen.
 * @param attempts - Number of attempts consumed so far
 * @param base - Exponential base
 * @returns ISO timestamp string
 */
export function computeNextAttemptAt(attempts: number, base: number): string {
  const delaySeconds = computeBackoffDelay(attempts, base);
  const nextTime = new Date(Date.now() + delaySeconds * 1000);
  return nextTime.toISOString();
}
