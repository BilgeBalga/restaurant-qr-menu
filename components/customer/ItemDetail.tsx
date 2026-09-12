"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuItemView, OptionGroupView } from "@/app/actions/menu";
import { useCart } from "@/components/customer/CartProvider";
import { computeOrderTotals } from "@/lib/business/pricing";
import { formatMoney as money } from "@/lib/format/money";
import { MenuItemImage } from "@/components/ui/MenuItemImage";

type Selections = Record<string, string[]>; // groupId -> choiceId[]

function groupSatisfied(group: OptionGroupView, selected: string[]): boolean {
  return selected.length >= group.minSelect && selected.length <= group.maxSelect;
}

export function ItemDetail({ item, currency }: { item: MenuItemView; currency: string }) {
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
          return { groupId: group.id, groupName: group.name, choiceId: choice.id, choiceName: choice.name, priceDeltaCents: choice.priceDeltaCents };
        }),
      ),
    [item.optionGroups, selections],
  );

  const estimatedTotal = computeOrderTotals(
    [{ unitPriceCents: item.priceCents, quantity, options: selectedOptionObjects.map((o) => ({ priceDeltaCents: o.priceDeltaCents })) }],
    0,
    0,
  ).subtotalCents;

  function handleAdd() {
    addLine({
      menuItemId: item.id,
      name: item.name,
      unitPriceCents: item.priceCents,
      quantity,
      options: selectedOptionObjects,
      lineNote: lineNote.trim() || undefined,
    });
    router.push("/menu");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6">
      <MenuItemImage
        name={item.name}
        imageUrl={item.imageUrl}
        className="mb-4 aspect-[4/3] w-full rounded-lg"
        monogramClassName="text-5xl"
      />
      <h1 className="font-display text-2xl font-semibold">{item.name}</h1>
      {item.description ? <p className="mt-2 text-[var(--color-charcoal-muted)]">{item.description}</p> : null}

      {item.ingredients && item.ingredients.length > 0 ? (
        <p className="mt-3 text-sm text-[var(--color-charcoal-muted)]">
          <span className="font-medium text-[var(--color-charcoal)]">Ingredients: </span>
          {item.ingredients.join(", ")}
        </p>
      ) : null}
      {item.allergens && item.allergens.length > 0 ? (
        <p className="mt-1 text-sm text-[var(--color-charcoal-muted)]">
          <span className="font-medium text-[var(--color-charcoal)]">Allergens: </span>
          {item.allergens.join(", ")}
        </p>
      ) : null}

      {item.optionGroups.map((group) => (
        <fieldset key={group.id} className="mt-6 border-t border-[var(--color-border)] pt-4">
          <legend className="mb-2 font-medium">
            {group.name}
            {group.isRequired ? <span className="ml-1 text-xs text-[var(--color-bronze-strong)]">Required</span> : null}
          </legend>
          <div className="flex flex-col gap-2">
            {group.choices.map((choice) => {
              const checked = (selections[group.id] ?? []).includes(choice.id);
              return (
                <label
                  key={choice.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                    choice.isAvailable ? "border-[var(--color-border)]" : "border-[var(--color-border)] opacity-40"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type={group.selectionType === "single" ? "radio" : "checkbox"}
                      name={group.id}
                      disabled={!choice.isAvailable}
                      checked={checked}
                      onChange={() => toggleChoice(group, choice.id)}
                    />
                    {choice.name}
                    {!choice.isAvailable ? <span className="text-xs">(unavailable)</span> : null}
                  </span>
                  {choice.priceDeltaCents !== 0 ? (
                    <span className="tabular-nums text-[var(--color-charcoal-muted)]">
                      {choice.priceDeltaCents > 0 ? "+" : ""}
                      {money(choice.priceDeltaCents, currency)}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="mt-6 border-t border-[var(--color-border)] pt-4">
        <label htmlFor="line-note" className="mb-1 block font-medium">
          Notes for the kitchen
        </label>
        <textarea
          id="line-note"
          value={lineNote}
          onChange={(e) => setLineNote(e.target.value)}
          maxLength={280}
          rows={2}
          placeholder="e.g. no onions"
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory-raised)] px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-[var(--color-border)] pt-4">
        <span className="font-medium">Quantity</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="h-8 w-8 rounded-full border border-[var(--color-border)]"
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span className="w-6 text-center tabular-nums">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(20, q + 1))}
            className="h-8 w-8 rounded-full border border-[var(--color-border)]"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
      </div>

      <div className="fixed inset-x-4 bottom-4 mx-auto max-w-2xl">
        <button
          type="button"
          disabled={!allRequiredSatisfied || !item.isAvailable}
          onClick={handleAdd}
          className="flex w-full items-center justify-between rounded-lg bg-[var(--color-bronze)] px-5 py-3.5 font-medium text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>Add to cart</span>
          <span className="tabular-nums">{money(estimatedTotal, currency)}</span>
        </button>
      </div>
    </div>
  );
}
