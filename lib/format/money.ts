/**
 * Deterministic money formatting — server and client must render the
 * identical string, or React hydration mismatches (exactly what
 * happened: `new Intl.NumberFormat(undefined, ...)` took the *runtime's*
 * default locale, which differs between the Node SSR process and the
 * browser). Every currency gets an explicit `numberLocale` controlling
 * only digit grouping/decimal separators — never `undefined`, never the
 * ambient environment. The symbol and its position are set directly
 * rather than left to a locale's currency-formatting heuristics, so the
 * result doesn't silently change if a locale's own symbol-placement
 * convention ever does.
 *
 * Isomorphic on purpose (no "server-only"/"use client" — Intl is
 * available in both the Node SSR process and the browser) so the exact
 * same function runs on both sides.
 */
interface CurrencyFormat {
  symbol: string;
  position: "prefix" | "suffix";
  numberLocale: string;
}

/** Single source of truth for "currencies the app knows how to format" — restaurant settings validation reuses this list rather than duplicating it. */
export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const CURRENCY_FORMATS: Record<SupportedCurrency, CurrencyFormat> = {
  EUR: { symbol: "€", position: "prefix", numberLocale: "de-DE" },
  USD: { symbol: "$", position: "prefix", numberLocale: "en-US" },
  GBP: { symbol: "£", position: "prefix", numberLocale: "en-GB" },
};

/** Unknown/future currencies still format deterministically — code prefix, US-style grouping. */
function fallbackFormat(currencyCode: string): CurrencyFormat {
  return { symbol: `${currencyCode} `, position: "prefix", numberLocale: "en-US" };
}

function isSupportedCurrency(currencyCode: string): currencyCode is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(currencyCode);
}

export function formatMoney(cents: number, currencyCode: string): string {
  const format = isSupportedCurrency(currencyCode) ? CURRENCY_FORMATS[currencyCode] : fallbackFormat(currencyCode);
  const number = new Intl.NumberFormat(format.numberLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

  return format.position === "suffix" ? `${number} ${format.symbol}` : `${format.symbol}${number}`;
}

/**
 * The admin menu form's counterpart to formatMoney: parses a human-typed
 * decimal string into integer cents WITHOUT ever multiplying/dividing a
 * float (that path produces e.g. 19.99 * 100 = 1998.9999999999998 for
 * some values) — split on the decimal point and treat both halves as
 * integers instead. Rejects anything that isn't a plain non-negative
 * amount with at most 2 decimal places (also rejects a leading "-",
 * which is exactly "reject negative prices" for a base item price).
 * Returns null on anything invalid rather than throwing — callers decide
 * how to surface that (a Zod .transform() issue, in practice).
 */
export function parseMoneyToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [wholePart, fractionPart = ""] = trimmed.split(".");
  return Number(wholePart) * 100 + Number(fractionPart.padEnd(2, "0"));
}

/** Same parsing, but allows a leading "-" — option price deltas (unlike a base price) are allowed to be negative in the schema (e.g. "no cheese: -$1.00"). */
export function parseMoneyDeltaToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const negative = trimmed.startsWith("-");
  const withoutSign = negative ? trimmed.slice(1) : trimmed;
  const [wholePart, fractionPart = ""] = withoutSign.split(".");
  const cents = Number(wholePart) * 100 + Number(fractionPart.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** The inverse of parseMoneyToCents/parseMoneyDeltaToCents — cents -> the decimal string an edit form should show, via integer arithmetic only. */
export function centsToInputString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.trunc(Math.abs(cents));
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
