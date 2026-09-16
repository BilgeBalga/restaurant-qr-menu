"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Only two tabs — "Menu" and "Orders" — because those are the only two
 * customer-facing capabilities that actually exist today. The Stitch
 * reference shows four tabs (adding a bill-split/payment tab and a
 * waiter-call tab), but neither of those features exists in this
 * application, so they're intentionally absent rather than shown as
 * decorative dead ends (§ redesign brief).
 *
 * "Orders" has no table-level "all my orders" capability to link to —
 * the only existing order-tracking surface is /order/[accessToken], a
 * capability-token URL. Stage 2's cart redesign now persists that token
 * to localStorage right after a successful createOrder (see
 * CartView.tsx), so this reads it back as a purely client-side "last
 * order for this table" pointer — never a new backend aggregate view.
 * If the order page itself is what's currently open, that IS the most
 * current order regardless of what's in localStorage (e.g. a second
 * device, or a stale/cleared value), so the pathname's own token wins.
 */
function lastOrderStorageKey(tableId: string): string {
  return `tableside:last-order:${tableId}`;
}

// SSR-safe localStorage read, same pattern/reasoning as CartProvider's
// CartStore: getServerSnapshot must return null (the server has no
// localStorage), so hydration never mismatches — a plain useEffect +
// setState here would read correctly but does it as a synchronous
// setState-in-effect (flagged by react-hooks/set-state-in-effect) and
// reintroduces the exact hydration-timing subtlety CartProvider already
// solved once. No subscribe callback is needed: nothing else in this
// tab writes this key while the component is mounted.
const noopSubscribe = () => () => {};

function readLastOrderToken(tableId: string | undefined): string | null {
  if (!tableId) return null;
  try {
    return localStorage.getItem(lastOrderStorageKey(tableId));
  } catch {
    return null;
  }
}

function serverSnapshot(): null {
  return null;
}

function MenuIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}

function OrdersIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path
        d="M7 3h10a1 1 0 0 1 1 1v16l-2.5-1.5L13 20l-2.5-1.5L8 20l-2.5-1.5L4 20V4a1 1 0 0 1 1-1h2Z"
        strokeLinejoin="round"
      />
      <path d="M8 8h8M8 12h8" strokeLinecap="round" />
    </svg>
  );
}

const tabItemClass =
  "flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]";

export function CustomerBottomNav({ tableId }: { tableId?: string }) {
  const pathname = usePathname();
  const storedLastOrderToken = useSyncExternalStore(noopSubscribe, () => readLastOrderToken(tableId), serverSnapshot);
  const [showNoOrderHint, setShowNoOrderHint] = useState(false);

  useEffect(() => {
    if (!showNoOrderHint) return;
    const id = setTimeout(() => setShowNoOrderHint(false), 3000);
    return () => clearTimeout(id);
  }, [showNoOrderHint]);

  const isMenuActive = pathname === "/menu" || Boolean(pathname?.startsWith("/menu/"));
  const isOrderPage = Boolean(pathname?.startsWith("/order/"));
  // Currently viewing an order: that page's own URL is the current order,
  // regardless of what localStorage happens to hold.
  const ordersHref = isOrderPage ? pathname : storedLastOrderToken ? `/order/${storedLastOrderToken}` : null;

  return (
    <nav
      aria-label="Customer navigation"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--color-hairline)] bg-[var(--color-surface)]/90 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-8px_24px_-4px_rgba(17,24,39,0.06)] backdrop-blur-xl"
    >
      {showNoOrderHint ? (
        // Fixed (not relative to this nav's own box) and lifted well clear
        // of it: the floating cart bar can be docked in the same stretch
        // of viewport just above the nav (see MenuBrowser's StickyBar), so
        // anchoring this to the nav's own top edge risked sitting right on
        // top of the cart bar instead of above it.
        <p
          role="status"
          className="fixed inset-x-4 bottom-[calc(9rem+env(safe-area-inset-bottom,0px))] z-50 mx-auto max-w-[440px] rounded-lg bg-[var(--color-ink)] px-3 py-2 text-center text-xs text-white shadow-lg"
        >
          You don&apos;t have an active order yet — place one from the menu.
        </p>
      ) : null}
      <div className="mx-auto flex h-16 max-w-[480px] items-center justify-around px-2">
        <Link
          href="/menu"
          aria-current={isMenuActive ? "page" : undefined}
          className={`${tabItemClass} ${isMenuActive ? "text-[var(--color-primary)]" : "text-[var(--color-ink-muted)]"}`}
        >
          <MenuIcon className="h-5 w-5" />
          <span>Menu</span>
        </Link>

        {ordersHref ? (
          <Link
            href={ordersHref}
            aria-current={isOrderPage ? "page" : undefined}
            className={`${tabItemClass} ${isOrderPage ? "text-[var(--color-primary)]" : "text-[var(--color-ink-muted)]"}`}
          >
            <OrdersIcon className="h-5 w-5" />
            <span>Orders</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setShowNoOrderHint((v) => !v)}
            className={`${tabItemClass} text-[var(--color-ink-muted)]/60`}
          >
            <OrdersIcon className="h-5 w-5" />
            <span>Orders</span>
          </button>
        )}
      </div>
    </nav>
  );
}
