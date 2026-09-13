/**
 * SaaS Phase 5's actual business rule, pulled out of lib/auth/session.ts's
 * I/O (the DB query, the cookie read, the redirect) so it can be unit-
 * tested directly — the same convention every other business rule in
 * this codebase already follows (lib/business/tableStatus.ts,
 * staffAccess.ts, orderStateMachine.ts).
 *
 * Deliberately generic over any membership-shaped array rather than
 * importing lib/auth/session.ts's StaffMembership — this module has no
 * business depending on the auth layer, and the algorithm only ever
 * needs restaurantId to do its job.
 */
export interface RestaurantMembershipLike {
  restaurantId: string;
}

export type RestaurantSelectionResult<T extends RestaurantMembershipLike> =
  | { status: "selected"; membership: T }
  | { status: "selection_required" };

/**
 * Resolution order:
 *   1. Exactly one active membership → that one, unconditionally. The
 *      selectedRestaurantId isn't even consulted — a single-restaurant
 *      user's outcome can never depend on cookie state at all, forged,
 *      stale, or otherwise.
 *   2. More than one → selectedRestaurantId must name one of THESE
 *      memberships (the caller's own, freshly queried) or it's treated
 *      as absent. This is the whole mechanism: a forged id, a stale id
 *      left over from a since-deactivated membership, or simply no
 *      cookie at all are indistinguishable here — all three just fail to
 *      find a match and fall through to "selection_required." There is
 *      no separate validity check to omit or get wrong.
 *   3. No match → selection_required. The caller (requireActiveMembership)
 *      turns this into a redirect; this function itself never redirects,
 *      throws, or does any I/O, which is what makes it unit-testable
 *      without a real request/cookie/DB at all.
 */
export function resolveActiveRestaurant<T extends RestaurantMembershipLike>(
  memberships: readonly T[],
  selectedRestaurantId: string | null,
): RestaurantSelectionResult<T> {
  if (memberships.length === 1) {
    return { status: "selected", membership: memberships[0]! };
  }

  const match = selectedRestaurantId
    ? memberships.find((membership) => membership.restaurantId === selectedRestaurantId)
    : undefined;

  return match ? { status: "selected", membership: match } : { status: "selection_required" };
}
