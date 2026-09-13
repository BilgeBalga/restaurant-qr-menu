import { describe, expect, it } from "vitest";
import { resolveActiveRestaurant, type RestaurantMembershipLike } from "@/lib/business/restaurantSelection";

interface TestMembership extends RestaurantMembershipLike {
  restaurantId: string;
  restaurantName: string;
}

const restaurantA: TestMembership = { restaurantId: "a", restaurantName: "Restaurant A" };
const restaurantB: TestMembership = { restaurantId: "b", restaurantName: "Restaurant B" };
const restaurantC: TestMembership = { restaurantId: "c", restaurantName: "Restaurant C" };

describe("resolveActiveRestaurant", () => {
  describe("exactly one membership", () => {
    it("selects the single membership regardless of any cookie value", () => {
      expect(resolveActiveRestaurant([restaurantA], null)).toEqual({ status: "selected", membership: restaurantA });
    });

    it("selects the single membership even when the cookie names a DIFFERENT restaurant entirely — a single-restaurant user can never be redirected by a forged/stale cookie", () => {
      expect(resolveActiveRestaurant([restaurantA], "some-other-restaurant-id")).toEqual({
        status: "selected",
        membership: restaurantA,
      });
    });
  });

  describe("multiple memberships, no cookie", () => {
    it("requires selection when there's no cookie at all", () => {
      expect(resolveActiveRestaurant([restaurantA, restaurantB], null)).toEqual({ status: "selection_required" });
    });
  });

  describe("multiple memberships, valid cookie", () => {
    it("selects restaurant A when the cookie names A", () => {
      expect(resolveActiveRestaurant([restaurantA, restaurantB], "a")).toEqual({ status: "selected", membership: restaurantA });
    });

    it("selects restaurant B when the cookie names B — switching is just a different cookie value", () => {
      expect(resolveActiveRestaurant([restaurantA, restaurantB], "b")).toEqual({ status: "selected", membership: restaurantB });
    });

    it("works with three or more memberships", () => {
      expect(resolveActiveRestaurant([restaurantA, restaurantB, restaurantC], "c")).toEqual({
        status: "selected",
        membership: restaurantC,
      });
    });
  });

  describe("multiple memberships, forged or stale cookie", () => {
    it("a cookie naming a restaurant the user has no membership in at all (forged) requires selection, never grants access to it", () => {
      const result = resolveActiveRestaurant([restaurantA, restaurantB], "not-a-real-membership-id");
      expect(result).toEqual({ status: "selection_required" });
      // Explicitly: the forged id never appears anywhere in the result.
      if (result.status === "selected") throw new Error("must not select on a forged cookie");
    });

    it("simulates a deactivated selected membership: the cookie still names A, but A is no longer in the caller's active membership list — falls through to selection_required, never silently to B", () => {
      // A's own deactivation is modeled by A simply not being in the list
      // passed in — this function only ever sees ALREADY-active
      // memberships (the DB query filters is_active=true before this is
      // ever called), so "deactivated" and "never existed" and "forged"
      // are indistinguishable to it by design.
      const result = resolveActiveRestaurant([restaurantB, restaurantC], "a");
      expect(result).toEqual({ status: "selection_required" });
    });

    it("simulates one of several memberships deactivated, leaving exactly one — auto-selects the survivor, ignoring a stale cookie that named a different (now-gone) restaurant", () => {
      // Started as [A, B, C] with cookie=A; B and C get deactivated,
      // leaving only A in the fresh list. Exactly-one short-circuits
      // before the cookie is even consulted.
      const result = resolveActiveRestaurant([restaurantA], "a");
      expect(result).toEqual({ status: "selected", membership: restaurantA });
    });

    it("simulates the selected membership deactivated while exactly one other survives — auto-selects the survivor even though the stale cookie still names the deactivated one", () => {
      // [A, B] with cookie=A; A gets deactivated, leaving only B.
      const result = resolveActiveRestaurant([restaurantB], "a");
      expect(result).toEqual({ status: "selected", membership: restaurantB });
    });
  });

  describe("zero memberships", () => {
    it("requires selection (the caller — requireStaffContext — is expected to have already redirected away before this is ever reached with an empty list, but the function itself must still fail safe)", () => {
      expect(resolveActiveRestaurant([], null)).toEqual({ status: "selection_required" });
      expect(resolveActiveRestaurant([], "a")).toEqual({ status: "selection_required" });
    });
  });
});
