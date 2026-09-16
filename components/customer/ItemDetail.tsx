"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuItemView, OptionGroupView } from "@/app/actions/menu";
import { useCart } from "@/components/customer/CartProvider";
import { computeOrderTotals } from "@/lib/business/pricing";
import { formatMoney as money } from "@/lib/format/money";
import { MenuItemImage } from "@/components/ui/MenuItemImage";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { StickyBar } from "@/components/ui/StickyBar";
import { CustomerBottomNav } from "@/components/customer/CustomerBottomNav";

type Selections = Record<string, string[]>; // groupId -> choiceId[]

function groupSatisfied(group: OptionGroupView, selected: string[]): boolean {
  return selected.length >= group.minSelect && selected.length <= group.maxSelect;
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

export function ItemDetail({ item, currency, tableId }: { item: MenuItemView; currency: string; tableId: string }) {
  const router = useRouter();
  const { addLine } = useCart();
  const [selections, setSelections] = useState<Selections>({});
  const [quantity, setQuantity] = useState(1);
  const [lineNote, setLineNote] = useState("");

  function toggleChoice(group: OptionGroupView, choiceId: string) {
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selectionType === "single") {
        return { ...prev, [group.id]: [choiceId] };
      }
      const next = current.includes(choiceId) ? current.filter((id) => id !== choiceId) : [...current, choiceId];
      if (next.length > group.maxSelect) return prev;
      return { ...prev, [group.id]: next };
    });
  }

  const allRequiredSatisfied = item.optionGroups
    .filter((g) => g.isRequired)
    .every((g) => groupSatisfied(g, selections[g.id] ?? []));

  const selectedOptionObjects = useMemo(
    () =>
      item.optionGroups.flatMap((group) =>
        (selections[group.id] ?? []).map((choiceId) => {
          const choice = group.choices.find((c) => c.id === choiceId)!;
          return {
            groupId: group.id,
            groupName: group.name,
            choiceId: choice.id,
            choiceName: choice.name,
            priceDeltaCents: choice.priceDeltaCents,
          };
        }),
      ),
    [item.optionGroups, selections],
  );

  const estimatedTotal = computeOrderTotals(
    [{ unitPriceCents: item.priceCents, quantity, options: selectedOptionObjects.map((o) => ({ priceDeltaCents: o.priceDeltaCents })) }],
    0,
    0,
  ).subtotalCents;

  const canAdd = allRequiredSatisfied && item.isAvailable;

  function handleAdd() {
    addLine({
      menuItemId: item.id,
      name: item.name,
      unitPriceCents: item.priceCents,
      quantity,
      options: selectedOptionObjects,
      lineNote: lineNote.trim() || undefined,
      imageUrl: item.imageUrl,
    });
    router.push("/menu");
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <div className="mx-auto w-full max-w-[480px] pb-[calc(11rem+env(safe-area-inset-bottom,0px))]">
        <div className="relative">
          <MenuItemImage
            name={item.name}
            imageUrl={item.imageUrl}
            className="aspect-[4/3] w-full"
            monogramClassName="text-6xl"
            fallbackBgClassName="bg-[var(--color-surface-sunken)]"
            fallbackTextClassName="text-[var(--color-primary)]"
          />
          {item.imageUrl ? (
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          ) : null}

          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back to menu"
            className="absolute left-4 top-[calc(1rem+env(safe-area-inset-top,0px))] flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-surface)]/90 text-[var(--color-ink)] shadow-md backdrop-blur-md transition-transform active:scale-90"
          >
            <BackIcon />
          </button>

          {item.isFeatured ? (
            <div className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top,0px))]">
              <Chip tone="success">Popular</Chip>
            </div>
          ) : null}

          {item.imageUrl ? (
            <h1 className="absolute inset-x-4 bottom-4 text-2xl font-bold tracking-tight text-white">
              {item.name}
            </h1>
          ) : null}
        </div>

        <div className="px-4">
          {!item.imageUrl ? (
            <h1 className="mb-1 mt-4 text-2xl font-bold text-[var(--color-ink)]">{item.name}</h1>
          ) : null}

          <Card className="mt-4 flex flex-col gap-2 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold tabular-nums text-[var(--color-ink)]">
                {money(item.priceCents, currency)}
              </span>
              <span className="text-xs font-medium text-[var(--color-ink-muted)]">Base price</span>
            </div>
            {item.description ? (
              <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">{item.description}</p>
            ) : null}
            {(item.ingredients && item.ingredients.length > 0) || (item.allergens && item.allergens.length > 0) ? (
              <div className="mt-1 flex flex-col gap-1 rounded-xl bg-[var(--color-surface-sunken)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                {item.ingredients && item.ingredients.length > 0 ? (
                  <p>
                    <span className="font-semibold text-[var(--color-ink)]">Ingredients: </span>
                    {item.ingredients.join(", ")}
                  </p>
                ) : null}
                {item.allergens && item.allergens.length > 0 ? (
                  <p>
                    <span className="font-semibold text-[var(--color-ink)]">Allergens: </span>
                    {item.allergens.join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}
            {!item.isAvailable ? (
              <div className="mt-1 flex items-center gap-2 rounded-xl bg-[var(--color-muted-bg)] px-3 py-2 text-sm font-medium text-[var(--color-muted)]">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-muted)]" aria-hidden="true" />
                This item is sold out right now.
              </div>
            ) : null}
          </Card>

          {item.optionGroups.map((group, index) => (
            <Card key={group.id} className="mt-4 flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-[var(--color-ink)]">
                    {index + 1}. {group.name}
                  </h2>
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {group.isRequired ? "Required" : "Optional"} &middot;{" "}
                    {group.selectionType === "single" ? "Choose one" : `Choose up to ${group.maxSelect}`}
                  </p>
                </div>
                <Chip tone={group.isRequired ? "primary" : "neutral"}>{group.isRequired ? "Required" : "Optional"}</Chip>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">{group.name}</legend>
                {group.choices.map((choice) => {
                  const checked = (selections[group.id] ?? []).includes(choice.id);
                  const unavailable = !choice.isAvailable;
                  return (
                    <label
                      key={choice.id}
                      className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                        unavailable
                          ? "cursor-not-allowed border-[var(--color-hairline)] bg-[var(--color-surface-sunken)] opacity-50"
                          : checked
                            ? "cursor-pointer border-[var(--color-primary)] bg-[var(--color-primary)]/8"
                            : "cursor-pointer border-[var(--color-hairline)] bg-[var(--color-surface)]"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type={group.selectionType === "single" ? "radio" : "checkbox"}
                          name={group.id}
                          disabled={unavailable}
                          checked={checked}
                          onChange={() => toggleChoice(group, choice.id)}
                          className="h-5 w-5 shrink-0 accent-[var(--color-primary)] disabled:cursor-not-allowed"
                        />
                        <span className={`text-sm font-medium ${checked ? "text-[var(--color-ink)]" : "text-[var(--color-ink)]"}`}>
                          {choice.name}
                          {unavailable ? <span className="ml-1 text-xs font-normal text-[var(--color-ink-muted)]">(unavailable)</span> : null}
                        </span>
                      </span>
                      {choice.priceDeltaCents !== 0 ? (
                        <span
                          className={`shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums ${
                            checked ? "text-[var(--color-primary)]" : "text-[var(--color-ink-muted)]"
                          }`}
                        >
                          {choice.priceDeltaCents > 0 ? "+" : ""}
                          {money(choice.priceDeltaCents, currency)}
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs font-medium text-[var(--color-ink-muted)]">Free</span>
                      )}
                    </label>
                  );
                })}
              </fieldset>
            </Card>
          ))}

          <Card className="mt-4 flex flex-col gap-2 p-4">
            <label htmlFor="line-note" className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-ink)]">
              Notes for the kitchen
            </label>
            <textarea
              id="line-note"
              value={lineNote}
              onChange={(e) => setLineNote(e.target.value)}
              maxLength={280}
              rows={2}
              placeholder="e.g. no onions"
              className="w-full resize-none rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-primary)] focus:bg-[var(--color-surface)] focus:outline-none"
            />
          </Card>

          <Card className="mt-4 flex items-center justify-between p-4">
            <span className="text-sm font-bold text-[var(--color-ink)]">Quantity</span>
            <div className="flex items-center gap-1 rounded-xl bg-[var(--color-surface-sunken)] p-1">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity === 1}
                aria-label="Decrease quantity"
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <MinusIcon />
              </button>
              <span className="w-8 text-center text-base font-bold tabular-nums text-[var(--color-ink)]" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                disabled={quantity === 20}
                aria-label="Increase quantity"
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-sm transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PlusIcon />
              </button>
            </div>
          </Card>
        </div>
      </div>

      <StickyBar offsetClassName="bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]" className="mb-2">
        <div className="rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-surface)]/95 p-3 shadow-[0_-8px_24px_-4px_rgba(18,28,42,0.12)] backdrop-blur-xl">
          <Button
            variant="primary"
            onClick={handleAdd}
            disabled={!canAdd}
            className="flex h-[52px] w-full items-center justify-between px-5 text-base"
          >
            <span>{!item.isAvailable ? "Sold out" : "Add to order"}</span>
            {item.isAvailable ? <span className="tabular-nums">{money(estimatedTotal, currency)}</span> : null}
          </Button>
          {item.isAvailable && !allRequiredSatisfied ? (
            <p className="mt-1.5 text-center text-xs text-[var(--color-ink-muted)]">Select the required options above to continue.</p>
          ) : null}
        </div>
      </StickyBar>

      <CustomerBottomNav tableId={tableId} />
    </div>
  );
}
