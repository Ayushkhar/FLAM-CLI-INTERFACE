

export function computeBackoffDelay(attempts: number, base: number): number {
 return Math.pow(base, attempts);
}

export function computeNextAttemptAt(attempts: number, base: number): string {
 const delaySeconds = computeBackoffDelay(attempts, base);
 const nextTime = new Date(Date.now() + delaySeconds * 1000);
 return nextTime.toISOString();
}
