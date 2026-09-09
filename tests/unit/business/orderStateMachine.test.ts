import { describe, expect, it } from "vitest";
import { canTransition, getAllowedTransitions, isTerminal } from "@/lib/business/orderStateMachine";

describe("canTransition", () => {
  it("allows staff to move an order through the normal happy path", () => {
    expect(canTransition("new", "preparing", "staff")).toBe(true);
    expect(canTransition("preparing", "ready", "staff")).toBe(true);
    expect(canTransition("ready", "completed", "staff")).toBe(true);
  });

  it("allows a staff correction from preparing back to new", () => {
    expect(canTransition("preparing", "new", "staff")).toBe(true);
  });

  it("lets staff cancel before ready, but not once ready", () => {
    expect(canTransition("new", "cancelled", "staff")).toBe(true);
    expect(canTransition("preparing", "cancelled", "staff")).toBe(true);
    expect(canTransition("ready", "cancelled", "staff")).toBe(false);
  });

  it("only admin can cancel a ready order (§11)", () => {
    expect(canTransition("ready", "cancelled", "admin")).toBe(true);
    expect(canTransition("ready", "cancelled", "staff")).toBe(false);
    expect(canTransition("ready", "cancelled", "kitchen")).toBe(false);
  });

  it("rejects same-status transitions as a no-op, not silently", () => {
    expect(canTransition("preparing", "preparing", "admin")).toBe(false);
  });

  it("rejects any transition out of a terminal status", () => {
    expect(canTransition("completed", "new", "admin")).toBe(false);
    expect(canTransition("cancelled", "preparing", "admin")).toBe(false);
  });

  it("rejects transitions that skip states entirely", () => {
    expect(canTransition("new", "ready", "admin")).toBe(false);
    expect(canTransition("new", "completed", "admin")).toBe(false);
  });

  it("default-denies roles with no defined transition rights (manager, kitchen)", () => {
    expect(canTransition("new", "preparing", "manager")).toBe(false);
    expect(canTransition("new", "preparing", "kitchen")).toBe(false);
  });
});

describe("getAllowedTransitions", () => {
  it("returns nothing for a terminal status", () => {
    expect(getAllowedTransitions("completed", "admin")).toEqual([]);
    expect(getAllowedTransitions("cancelled", "admin")).toEqual([]);
  });

  it("gives admin every legal move out of ready, staff one fewer", () => {
    expect(getAllowedTransitions("ready", "admin").sort()).toEqual(["cancelled", "completed"]);
    expect(getAllowedTransitions("ready", "staff").sort()).toEqual(["completed"]);
  });
});

describe("isTerminal", () => {
  it("flags completed and cancelled as terminal, nothing else", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("new")).toBe(false);
    expect(isTerminal("preparing")).toBe(false);
    expect(isTerminal("ready")).toBe(false);
  });
});
