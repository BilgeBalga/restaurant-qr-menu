import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPollFallback } from "@/lib/realtime/pollFallback";

describe("startPollFallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never polls while the connection stays reported as connected", () => {
    const onPoll = vi.fn();
    const fallback = startPollFallback({ onPoll, watchdogIntervalMs: 100, pollIntervalMs: 200 });

    vi.advanceTimersByTime(5_000);
    expect(onPoll).not.toHaveBeenCalled();

    fallback.stop();
  });

  it("starts polling at the configured interval once marked disconnected", () => {
    const onPoll = vi.fn();
    const fallback = startPollFallback({ onPoll, watchdogIntervalMs: 100, pollIntervalMs: 200 });

    fallback.setConnected(false);
    vi.advanceTimersByTime(100); // watchdog tick notices the disconnect and starts the poll loop
    expect(onPoll).not.toHaveBeenCalled(); // poll loop just started, hasn't fired yet

    vi.advanceTimersByTime(200);
    expect(onPoll).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(onPoll).toHaveBeenCalledTimes(2);

    fallback.stop();
  });

  it("stops polling the moment the connection is marked connected again", () => {
    const onPoll = vi.fn();
    const fallback = startPollFallback({ onPoll, watchdogIntervalMs: 100, pollIntervalMs: 200 });

    fallback.setConnected(false);
    vi.advanceTimersByTime(300); // one watchdog tick starts the loop, one poll tick fires
    expect(onPoll).toHaveBeenCalledTimes(1);

    fallback.setConnected(true);
    vi.advanceTimersByTime(1_000); // next watchdog tick tears the poll loop down; no further polls
    expect(onPoll).toHaveBeenCalledTimes(1);

    fallback.stop();
  });

  it("never creates more than one poll loop even if disconnected is reported repeatedly", () => {
    const onPoll = vi.fn();
    const fallback = startPollFallback({ onPoll, watchdogIntervalMs: 100, pollIntervalMs: 200 });

    fallback.setConnected(false);
    vi.advanceTimersByTime(100); // starts the one poll loop (first tick due at cumulative t=300)
    fallback.setConnected(false); // reported again — must not start a second loop
    fallback.setConnected(false);
    vi.advanceTimersByTime(200); // reaches t=300 — a duplicate loop would fire twice here instead of once

    expect(onPoll).toHaveBeenCalledTimes(1);

    fallback.stop();
  });

  it("a reconnect blip immediately followed by another disconnect keeps exactly one poll loop running", () => {
    const onPoll = vi.fn();
    const fallback = startPollFallback({ onPoll, watchdogIntervalMs: 100, pollIntervalMs: 200 });

    fallback.setConnected(false);
    vi.advanceTimersByTime(100); // loop A starts
    fallback.setConnected(true); // reconnect before the next watchdog tick
    fallback.setConnected(false); // disconnect again before the next watchdog tick
    vi.advanceTimersByTime(300); // watchdog sees "disconnected" (the latest value) — loop A just keeps running

    expect(onPoll).toHaveBeenCalledTimes(1);

    fallback.stop();
  });

  it("stop() clears the watchdog and any active poll loop — no further polling even while disconnected", () => {
    const onPoll = vi.fn();
    const fallback = startPollFallback({ onPoll, watchdogIntervalMs: 100, pollIntervalMs: 200 });

    fallback.setConnected(false);
    vi.advanceTimersByTime(300);
    expect(onPoll).toHaveBeenCalledTimes(1);

    fallback.stop();
    vi.advanceTimersByTime(10_000);
    expect(onPoll).toHaveBeenCalledTimes(1);
  });

  it("stop() is safe to call when a poll loop never started", () => {
    const onPoll = vi.fn();
    const fallback = startPollFallback({ onPoll, watchdogIntervalMs: 100, pollIntervalMs: 200 });

    expect(() => fallback.stop()).not.toThrow();
    vi.advanceTimersByTime(10_000);
    expect(onPoll).not.toHaveBeenCalled();
  });

  it("defaults to the project's standard 5s watchdog / 15s poll cadence (§16)", () => {
    const onPoll = vi.fn();
    const fallback = startPollFallback({ onPoll });

    fallback.setConnected(false);
    vi.advanceTimersByTime(4_999);
    expect(onPoll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1); // t=5_000 — watchdog notices the disconnect, poll loop starts
    vi.advanceTimersByTime(14_999);
    expect(onPoll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1); // t=20_000 — poll loop's first 15s tick fires
    expect(onPoll).toHaveBeenCalledTimes(1);

    fallback.stop();
  });
});
