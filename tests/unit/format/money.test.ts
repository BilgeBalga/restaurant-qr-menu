import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format/money";

describe("formatMoney", () => {
  it("formats EUR with a comma decimal and no space before the symbol — the exact reported hydration-mismatch case", () => {
    expect(formatMoney(1400, "EUR")).toBe("€14,00");
  });

  it("formats USD with a period decimal", () => {
    expect(formatMoney(1400, "USD")).toBe("$14.00");
  });

  it("formats GBP with a period decimal", () => {
    expect(formatMoney(1400, "GBP")).toBe("£14.00");
  });

  it("applies correct grouping separators per currency for larger amounts", () => {
    expect(formatMoney(123450, "EUR")).toBe("€1.234,50");
    expect(formatMoney(123450, "USD")).toBe("$1,234.50");
  });

  it("falls back deterministically for an unmapped currency instead of throwing", () => {
    expect(formatMoney(1400, "CHF")).toBe("CHF 14.00");
  });

  it("never depends on a runtime-provided locale — repeated calls with the same input are always byte-identical", () => {
    const a = formatMoney(999, "EUR");
    const b = formatMoney(999, "EUR");
    expect(a).toBe(b);
    expect(a).toBe("€9,99");
  });
});
