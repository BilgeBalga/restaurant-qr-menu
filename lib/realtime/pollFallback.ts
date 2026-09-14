export interface PollFallbackController {
  /** Call from the channel's `.subscribe()` status callback whenever the connection status changes. */
  setConnected: (connected: boolean) => void;
  /** Clears the watchdog and any currently-running poll interval. Idempotent. */
  stop: () => void;
}

/**
 * The realtime fallback pattern already proven by OrdersBoard/OrderTracker
 * (§16): a watchdog checks the connection flag on an interval and starts a
 * poll loop only while disconnected, tearing it down the instant the flag
 * flips back to connected — never a second poll loop, never one left
 * running after reconnecting. Pulled out here (lib/realtime/, previously
 * just a placeholder) so this scheduling logic is unit-testable without a
 * DOM/React render, rather than duplicated inline a third time.
 *
 * `connected` is a plain closure variable, not React state — the watchdog
 * always reads its latest value directly, so there's no stale-closure risk
 * from an effect's dependency array. `setConnected` is the only mutation
 * surface, so a caller can't end up with two poll loops by calling it
 * twice with the same value: starting/stopping is gated on whether a poll
 * is already running, not on the transition itself.
 */
export function startPollFallback({
  onPoll,
  watchdogIntervalMs = 5_000,
  pollIntervalMs = 15_000,
}: {
  onPoll: () => void;
  watchdogIntervalMs?: number;
  pollIntervalMs?: number;
}): PollFallbackController {
  let connected = true;
  let pollId: ReturnType<typeof setInterval> | null = null;

  const watchdog = setInterval(() => {
    if (!connected && !pollId) {
      pollId = setInterval(onPoll, pollIntervalMs);
    }
    if (connected && pollId) {
      clearInterval(pollId);
      pollId = null;
    }
  }, watchdogIntervalMs);

  return {
    setConnected: (value: boolean) => {
      connected = value;
    },
    stop: () => {
      clearInterval(watchdog);
      if (pollId) clearInterval(pollId);
    },
  };
}
