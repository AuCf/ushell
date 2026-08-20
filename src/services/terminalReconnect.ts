export const MAX_RECONNECT_ATTEMPTS = 3;
export const RECONNECT_DELAY_MS = 3000;

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAY_MS * Math.max(1, Math.min(attempt, MAX_RECONNECT_ATTEMPTS));
}
