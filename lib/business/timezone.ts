/**
 * Pure timezone helpers — no DB/network I/O, unit-tested directly (same
 * convention as orderStateMachine.ts/tableStatus.ts). Two call sites:
 * restaurant-settings validation ("is this a real IANA zone?") and the
 * staff dashboard's "today" boundary, which used to be the server
 * process's own local time regardless of which timezone the restaurant
 * is actually in.
 */

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find((p) => p.type === type)?.value ?? 0);
}

/** The UTC offset (in minutes, positive east of UTC) `timeZone` observes at the instant `at` — DST-aware because it asks Intl for that specific instant, not a fixed constant. */
function timeZoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const wallClockReadAsUTC = Date.UTC(
    datePart(parts, "year"),
    datePart(parts, "month") - 1,
    datePart(parts, "day"),
    datePart(parts, "hour"),
    datePart(parts, "minute"),
    datePart(parts, "second"),
  );
  return (wallClockReadAsUTC - at.getTime()) / 60_000;
}

/** Midnight "today" in `timeZone`, as the UTC instant it corresponds to — the boundary the dashboard's "completed today" / "revenue today" queries filter on. */
export function startOfDayInTimeZone(timeZone: string, at: Date = new Date()): Date {
  const offsetMinutes = timeZoneOffsetMinutes(timeZone, at);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);

  const localMidnightReadAsUTC = Date.UTC(datePart(parts, "year"), datePart(parts, "month") - 1, datePart(parts, "day"), 0, 0, 0);
  return new Date(localMidnightReadAsUTC - offsetMinutes * 60_000);
}

/**
 * Midnight "tomorrow" in `timeZone` — the exclusive upper bound for a
 * single calendar day's boundary query (staff order history's "today"
 * filter: `created_at >= startOfDay AND created_at < startOfNextDay`).
 * Reuses startOfDayInTimeZone rather than adding a fixed 24h offset to an
 * already-midnight instant, so it stays correct across a DST transition
 * (a 23h or 25h local day still lands on the next calendar date when read
 * back through Intl at the shifted instant).
 */
export function startOfNextDayInTimeZone(timeZone: string, at: Date = new Date()): Date {
  const roughlyNextDay = new Date(at.getTime() + 24 * 60 * 60 * 1000);
  return startOfDayInTimeZone(timeZone, roughlyNextDay);
}
