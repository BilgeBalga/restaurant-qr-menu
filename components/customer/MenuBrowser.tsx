"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CategoryView, MenuItemView } from "@/app/actions/menu";
import { useCart } from "@/components/customer/CartProvider";
import { formatMoney as money } from "@/lib/format/money";
import { MenuItemImage } from "@/components/ui/MenuItemImage";
import { Card } from "@/components/ui/Card";
import { Chip, ChipLink } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { StickyBar } from "@/components/ui/StickyBar";
import { CustomerBottomNav } from "@/components/customer/CustomerBottomNav";

function categoryAnchorId(categoryId: string): string {
  return `cat-${categoryId}`;
}

/**
 * Sold-out items are visually distinct and structurally non-interactive
 * (a plain <div>, not a disabled-but-still-focusable <Link>) — a
 * keyboard user tabbing past one can't "activate" a dead link that does
 * nothing, unlike the previous implementation. Available items keep the
 * exact same href/navigation as before: the whole card still links to
 * /menu/[itemId], since that's where option-group selection (required
 * for many items) actually happens — the leading "+" is a visual
 * affordance toward that existing flow, not a new instant-add action.
 */
function ItemCard({ item, currency }: { item: MenuItemView; currency: string }) {
  const soldOut = !item.isAvailable;

  const media = (
    <MenuItemImage
      name={item.name}
      imageUrl={item.imageUrl}
      className="h-20 w-20 shrink-0 rounded-xl sm:h-24 sm:w-24"
      monogramClassName="text-2xl"
      fallbackBgClassName="bg-[var(--color-surface-sunken)]"
      fallbackTextClassName="text-[var(--color-primary)]"
    />
  );

  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2">
        <h3 className="truncate text-base font-semibold text-[var(--color-ink)]">{item.name}</h3>
        <span className="whitespace-nowrap tabular-nums font-bold text-[var(--color-primary)]">
          {money(item.priceCents, currency)}
        </span>
      </div>
      {item.shortDescription ? (
        <p className="mt-1 line-clamp-2 text-sm text-[var(--color-ink-muted)]">{item.shortDescription}</p>
      ) : null}
      <div className="mt-2 flex items-center justify-between">
        {item.isFeatured ? (
          <Chip tone="success" className="normal-case">
            Popular
          </Chip>
        ) : (
          <span />
        )}
        {soldOut ? (
          <Chip tone="muted">Sold out</Chip>
        ) : (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );

  if (soldOut) {
    return (
      <Card className="flex gap-4 p-4 opacity-60">
        {media}
        {body}
      </Card>
    );
  }

  return (
    <Link href={`/menu/${item.id}`} className="block">
      <Card className="flex gap-4 p-4 transition-shadow hover:shadow-[0_4px_12px_-2px_rgba(17,24,39,0.06),0_2px_6px_-1px_rgba(17,24,39,0.03)]">
        {media}
        {body}
      </Card>
    </Link>
  );
}

export function MenuBrowser({
  restaurantName,
  tableLabel,
  tableId,
  currency,
  orderingEnabled,
  categories,
}: {
  restaurantName: string;
  tableLabel: string;
  tableId: string;
  currency: string;
  orderingEnabled: boolean;
  categories: CategoryView[];
}) {
  const [query, setQuery] = useState("");
  const { lineCount, estimateTotalCents } = useCart();

  const featured = useMemo(
    () => categories.flatMap((c) => c.items).filter((item) => item.isFeatured && item.isAvailable),
    [categories],
  );

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((category) => ({
        ...category,
        items: category.items.filter(
          (item) => item.name.toLowerCase().includes(q) || item.shortDescription?.toLowerCase().includes(q),
        ),
      }))
      .filter((category) => category.items.length > 0);
  }, [categories, query]);

  const isMenuEmpty = categories.length === 0;
  const hasNoSearchResults = !isMenuEmpty && query.trim() !== "" && filteredCategories.length === 0;

  // 0/0: the customer app has no RLS grant to read tax/service-charge
  // rates directly (§26) — this is the same honest subtotal-only
  // estimate CartView already shows, not a claim about the real total.
  const subtotalPreviewCents = estimateTotalCents(0, 0);

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <div className="mx-auto w-full max-w-[480px] px-4 pb-[calc(10rem+env(safe-area-inset-bottom,0px))] pt-6">
        <header className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Table {tableLabel}</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-[var(--color-ink)]">{restaurantName}</h1>
        </header>

        <Card className="relative mb-4 overflow-hidden bg-[var(--color-surface-sunken)] p-4">
          <p className="text-sm leading-snug text-[var(--color-ink-muted)]">
            Browse the menu, send your order straight to the kitchen, and track it live from this table — no app to
            download.
          </p>
        </Card>

        {!orderingEnabled ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning)]">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
            This restaurant isn&apos;t taking orders right now — you can still browse the menu.
          </div>
        ) : null}

        <div className="mb-4">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the menu"
            aria-label="Search the menu"
          />
        </div>

        {!query && categories.length > 1 ? (
          <nav
            aria-label="Menu categories"
            className="sticky top-0 z-30 -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {categories.map((category) => (
              <ChipLink key={category.id} href={`#${categoryAnchorId(category.id)}`} tone="neutral">
                {category.name}
              </ChipLink>
            ))}
          </nav>
        ) : null}

        {featured.length > 0 && !query ? (
          <section className="mb-8">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-[var(--color-ink)]">
              <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden="true" />
              Popular
            </h2>
            <div className="flex flex-col gap-3">
              {featured.map((item) => (
                <ItemCard key={item.id} item={item} currency={currency} />
              ))}
            </div>
          </section>
        ) : null}

        {filteredCategories.map((category) => (
          <section key={category.id} id={categoryAnchorId(category.id)} className="mb-8 scroll-mt-16">
            <h2 className="mb-3 text-sm font-bold text-[var(--color-ink)]">{category.name}</h2>
            <div className="flex flex-col gap-3">
              {category.items.map((item) => (
                <ItemCard key={item.id} item={item} currency={currency} />
              ))}
            </div>
          </section>
        ))}

        {isMenuEmpty ? (
          <p className="py-10 text-center text-sm text-[var(--color-ink-muted)]">
            This menu doesn&apos;t have any items yet — check back soon.
          </p>
        ) : null}
        {hasNoSearchResults ? (
          <p className="py-10 text-center text-sm text-[var(--color-ink-muted)]">
            No items match &ldquo;{query}&rdquo;.
          </p>
        ) : null}
      </div>

      {lineCount > 0 ? (
        <StickyBar offsetClassName="bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]" className="mb-2">
          <Link
            href="/cart"
            className="flex items-center justify-between rounded-2xl bg-[var(--color-surface)]/95 p-3 shadow-[0_8px_24px_-4px_rgba(17,24,39,0.16)] backdrop-blur-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            <span className="flex items-center gap-3 pl-1">
              <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-primary)] text-[var(--color-on-primary)]">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                  <path d="M6 7h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7Z" strokeLinejoin="round" />
                  <path d="M9 7V5a3 3 0 0 1 6 0v2" strokeLinecap="round" />
                </svg>
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-success)] px-1 text-[11px] font-bold text-white">
                  {lineCount}
                </span>
              </span>
              <span className="flex flex-col items-start">
                <span className="font-bold tabular-nums text-[var(--color-ink)]">{money(subtotalPreviewCents, currency)}</span>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {lineCount} {lineCount === 1 ? "item" : "items"} in your cart
                </span>
              </span>
            </span>
            <span className="flex h-11 items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-on-primary)]">
              View cart
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>
        </StickyBar>
      ) : null}

      <CustomerBottomNav tableId={tableId} />
    </div>
  );
}
