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

const CURRENCY_FORMATS: Record<string, CurrencyFormat> = {
  EUR: { symbol: "€", position: "prefix", numberLocale: "de-DE" },
  USD: { symbol: "$", position: "prefix", numberLocale: "en-US" },
  GBP: { symbol: "£", position: "prefix", numberLocale: "en-GB" },
};

/** Unknown/future currencies still format deterministically — code prefix, US-style grouping. */
function fallbackFormat(currencyCode: string): CurrencyFormat {
  return { symbol: `${currencyCode} `, position: "prefix", numberLocale: "en-US" };
}

export function formatMoney(cents: number, currencyCode: string): string {
  const format = CURRENCY_FORMATS[currencyCode] ?? fallbackFormat(currencyCode);
  const number = new Intl.NumberFormat(format.numberLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

  return format.position === "suffix" ? `${number} ${format.symbol}` : `${format.symbol}${number}`;
}
