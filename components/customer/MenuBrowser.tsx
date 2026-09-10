"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CategoryView, MenuItemView } from "@/app/actions/menu";
import { useCart } from "@/components/customer/CartProvider";

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function ItemCard({ item, currency }: { item: MenuItemView; currency: string }) {
  const disabled = !item.isAvailable;
  return (
    <Link
      href={disabled ? "#" : `/menu/${item.id}`}
      aria-disabled={disabled}
      className={`flex gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-4 transition ${
        disabled ? "pointer-events-none opacity-50" : "hover:border-[var(--color-bronze)]"
      }`}
    >
      <div className="flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-lg font-medium">{item.name}</h3>
          <span className="whitespace-nowrap font-medium tabular-nums">{money(item.priceCents, currency)}</span>
        </div>
        {item.shortDescription ? (
          <p className="mt-1 text-sm text-[var(--color-charcoal-muted)]">{item.shortDescription}</p>
        ) : null}
        {disabled ? <p className="mt-2 text-xs font-medium uppercase tracking-wide text-red-700">Sold out</p> : null}
      </div>
    </Link>
  );
}

export function MenuBrowser({
  restaurantName,
  tableLabel,
  currency,
  orderingEnabled,
  categories,
}: {
  restaurantName: string;
  tableLabel: string;
  currency: string;
  orderingEnabled: boolean;
  categories: CategoryView[];
}) {
  const [query, setQuery] = useState("");
  const { lineCount } = useCart();

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

  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-6">
      <header className="mb-5">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-bronze-strong)]">
          Table {tableLabel}
        </p>
        <h1 className="font-display text-3xl font-semibold">{restaurantName}</h1>
      </header>

      {!orderingEnabled ? (
        <p className="mb-5 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900">
          This restaurant isn&apos;t taking orders right now — you can still browse the menu.
        </p>
      ) : null}

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the menu"
        className="mb-6 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory-raised)] px-4 py-2.5 text-sm"
        aria-label="Search the menu"
      />

      {featured.length > 0 && !query ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-charcoal-muted)]">
            Featured
          </h2>
          <div className="flex flex-col gap-3">
            {featured.map((item) => (
              <ItemCard key={item.id} item={item} currency={currency} />
            ))}
          </div>
        </section>
      ) : null}

      {filteredCategories.map((category) => (
        <section key={category.id} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-charcoal-muted)]">
            {category.name}
          </h2>
          <div className="flex flex-col gap-3">
            {category.items.map((item) => (
              <ItemCard key={item.id} item={item} currency={currency} />
            ))}
          </div>
        </section>
      ))}

      {filteredCategories.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-charcoal-muted)]">No items match &ldquo;{query}&rdquo;.</p>
      ) : null}

      {lineCount > 0 ? (
        <Link
          href="/cart"
          className="fixed inset-x-4 bottom-4 mx-auto flex max-w-2xl items-center justify-between rounded-lg bg-[var(--color-bronze)] px-5 py-3.5 text-white shadow-lg"
        >
          <span className="font-medium">View cart</span>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-semibold">{lineCount}</span>
        </Link>
      ) : null}
    </div>
  );
}
