import { describe, expect, it } from "vitest";
import { centsToInputString, parseMoneyDeltaToCents, parseMoneyToCents } from "@/lib/format/money";

describe("parseMoneyToCents", () => {
  it("parses whole and fractional amounts without float drift", () => {
    expect(parseMoneyToCents("12")).toBe(1200);
    expect(parseMoneyToCents("12.5")).toBe(1250);
    expect(parseMoneyToCents("12.50")).toBe(1250);
    expect(parseMoneyToCents("19.99")).toBe(1999);
    expect(parseMoneyToCents("0")).toBe(0);
    expect(parseMoneyToCents("0.01")).toBe(1);
  });

  it("rejects negative amounts", () => {
    expect(parseMoneyToCents("-1")).toBeNull();
    expect(parseMoneyToCents("-0.01")).toBeNull();
  });

  it("rejects more than 2 decimal places, empty input, and non-numeric input", () => {
    expect(parseMoneyToCents("12.999")).toBeNull();
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("12,50")).toBeNull();
    expect(parseMoneyToCents("$12.50")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseMoneyToCents("  12.50  ")).toBe(1250);
  });
});

describe("parseMoneyDeltaToCents", () => {
  it("parses positive and negative deltas", () => {
    expect(parseMoneyDeltaToCents("1.50")).toBe(150);
    expect(parseMoneyDeltaToCents("-1.50")).toBe(-150);
    expect(parseMoneyDeltaToCents("0")).toBe(0);
    expect(parseMoneyDeltaToCents("-0.01")).toBe(-1);
  });

  it("rejects invalid input the same way parseMoneyToCents does", () => {
    expect(parseMoneyDeltaToCents("12.999")).toBeNull();
    expect(parseMoneyDeltaToCents("")).toBeNull();
    expect(parseMoneyDeltaToCents("--1")).toBeNull();
  });
});

describe("centsToInputString", () => {
  it("is the exact inverse of parseMoneyToCents for valid amounts", () => {
    for (const input of ["12.00", "19.99", "0.01", "0.00", "1200.50"]) {
      const cents = parseMoneyToCents(input)!;
      expect(centsToInputString(cents)).toBe(input);
    }
  });

  it("renders negative deltas with a leading minus", () => {
    expect(centsToInputString(-150)).toBe("-1.50");
    expect(centsToInputString(-1)).toBe("-0.01");
  });
});
