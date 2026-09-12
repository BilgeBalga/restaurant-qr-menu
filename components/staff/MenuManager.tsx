"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createCategory,
  deleteCategory,
  reorderCategory,
  reorderMenuItem,
  setMenuItemAvailability,
  updateCategory,
  type AdminCategoryView,
  type AdminMenuView,
} from "@/app/actions/menuAdmin";
import { formatMoney } from "@/lib/format/money";
import type { StaffRole } from "@/lib/business/orderStateMachine";
import { MenuItemEditor } from "@/components/staff/MenuItemEditor";

const cardClass = "rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)]";
const inputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-3 py-2 text-sm focus:border-[var(--color-bronze)] focus:outline-none";
const smallButtonClass = "rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-ivory)] disabled:opacity-40";

export function MenuManager({ initial, role }: { initial: AdminMenuView; role: StaffRole }) {
  const isAdmin = role === "admin";
  const [currency] = useState(initial.currency);
  const [categories, setCategories] = useState(initial.categories);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(initial.categories[0]?.id ?? null);
  const [editingItemId, setEditingItemId] = useState<string | "new" | null>(null);
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );

  function replaceCategory(updated: Partial<AdminCategoryView> & { id: string }) {
    setCategories((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  }

  function flash(message: string) {
    setNotice(message);
    setError(null);
  }

  function fail(message: string) {
    setError(message);
    setNotice(null);
  }

  function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const result = await createCategory({ name });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setCategories((prev) => [...prev, result.data]);
      setSelectedCategoryId(result.data.id);
      setNewCategoryName("");
      flash("Category created.");
    });
  }

  function handleRenameCategory(id: string, name: string) {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await updateCategory({ id, name: name.trim() });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      replaceCategory({ id, name: result.data.name, slug: result.data.slug });
      setRenamingCategoryId(null);
      flash("Category renamed.");
    });
  }

  function handleToggleCategoryActive(category: AdminCategoryView) {
    setError(null);
    startTransition(async () => {
      const result = await updateCategory({ id: category.id, isActive: !category.isActive });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      replaceCategory({ id: category.id, isActive: result.data.isActive });
      flash(result.data.isActive ? "Category activated." : "Category deactivated — hidden from customers.");
    });
  }

  function handleDeleteCategory(category: AdminCategoryView) {
    if (!window.confirm(`Delete "${category.name}"? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCategory({ id: category.id });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setCategories((prev) => prev.filter((c) => c.id !== category.id));
      if (selectedCategoryId === category.id) setSelectedCategoryId(null);
      flash("Category deleted.");
    });
  }

  function handleReorderCategory(category: AdminCategoryView, direction: "up" | "down") {
    setError(null);
    const ordered = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const index = ordered.findIndex((c) => c.id === category.id);
    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    const neighbor = ordered[neighborIndex];
    if (!neighbor) return;

    startTransition(async () => {
      const result = await reorderCategory({ id: category.id, direction });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setCategories((prev) =>
        prev.map((c) => {
          if (c.id === category.id) return { ...c, sortOrder: neighbor.sortOrder };
          if (c.id === neighbor.id) return { ...c, sortOrder: category.sortOrder };
          return c;
        }),
      );
    });
  }

  function handleToggleAvailability(itemId: string, isAvailable: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setMenuItemAvailability({ id: itemId, isAvailable });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setCategories((prev) =>
        prev.map((c) => ({
          ...c,
          items: c.items.map((item) => (item.id === itemId ? { ...item, isAvailable: result.data.isAvailable } : item)),
        })),
      );
    });
  }

  function handleReorderItem(categoryId: string, itemId: string, sortOrder: number, neighborId: string, neighborSortOrder: number) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id !== categoryId
          ? c
          : {
              ...c,
              items: c.items.map((item) => {
                if (item.id === itemId) return { ...item, sortOrder: neighborSortOrder };
                if (item.id === neighborId) return { ...item, sortOrder };
                return item;
              }),
            },
      ),
    );
  }

  function applyMenuItemChange(updatedCategoryId: string, item: AdminCategoryView["items"][number], isNew: boolean) {
    setCategories((prev) =>
      prev.map((c) => {
        const withoutItem = { ...c, items: c.items.filter((i) => i.id !== item.id) };
        if (c.id !== updatedCategoryId) return withoutItem;
        return { ...withoutItem, items: [...withoutItem.items, item] };
      }),
    );
    // A brand-new item can't have option groups yet (nothing to point
    // menu_item_id at until it exists) — keep the editor open, now in
    // edit mode for the just-created item, so adding option groups is
    // one continuous flow instead of "create, close, reopen, edit."
    setEditingItemId(isNew ? item.id : null);
    flash(isNew ? "Item created — add option groups below, or click Close." : "Item saved.");
  }

  function handleItemDeleted(categoryId: string, itemId: string) {
    setCategories((prev) => prev.map((c) => (c.id !== categoryId ? c : { ...c, items: c.items.filter((i) => i.id !== itemId) })));
    setEditingItemId(null);
    flash("Item deleted.");
  }

  const sortedCategories = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  return (
    <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
      <aside className={`${cardClass} p-3`}>
        <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-charcoal-muted)]">Categories</h2>
        <ul className="flex flex-col gap-1">
          {sortedCategories.map((category, index) => (
            <li key={category.id}>
              {renamingCategoryId === category.id ? (
                <RenameForm
                  initialName={category.name}
                  onSave={(name) => handleRenameCategory(category.id, name)}
                  onCancel={() => setRenamingCategoryId(null)}
                />
              ) : (
                <div
                  className={`flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-sm ${
                    selectedCategoryId === category.id ? "bg-[var(--color-bronze)]/10 font-medium" : "hover:bg-[var(--color-ivory)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryId(category.id)}
                    className={`flex-1 truncate text-left ${category.isActive ? "" : "text-[var(--color-charcoal-muted)] italic"}`}
                  >
                    {category.name}
                    <span className="ml-1 text-xs text-[var(--color-charcoal-muted)]">({category.items.length})</span>
                  </button>
                  {isAdmin ? (
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        disabled={isPending || index === 0}
                        onClick={() => handleReorderCategory(category, "up")}
                        aria-label={`Move ${category.name} up`}
                        className="px-1 text-[var(--color-charcoal-muted)] hover:text-[var(--color-charcoal)] disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={isPending || index === sortedCategories.length - 1}
                        onClick={() => handleReorderCategory(category, "down")}
                        aria-label={`Move ${category.name} down`}
                        className="px-1 text-[var(--color-charcoal-muted)] hover:text-[var(--color-charcoal)] disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
              {isAdmin && renamingCategoryId !== category.id ? (
                <div className="flex gap-1 px-2 pb-1 text-xs text-[var(--color-charcoal-muted)]">
                  <button type="button" onClick={() => setRenamingCategoryId(category.id)} className="hover:underline">
                    Rename
                  </button>
                  <span>·</span>
                  <button type="button" onClick={() => handleToggleCategoryActive(category)} className="hover:underline">
                    {category.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <span>·</span>
                  <button type="button" onClick={() => handleDeleteCategory(category)} className="text-red-700 hover:underline">
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {isAdmin ? (
          <div className="mt-3 border-t border-[var(--color-border)] pt-3">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name"
              className={inputClass}
            />
            <button
              type="button"
              disabled={isPending || !newCategoryName.trim()}
              onClick={handleCreateCategory}
              className="mt-2 w-full rounded-md bg-[var(--color-bronze)] px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add category
            </button>
          </div>
        ) : null}
      </aside>

      <section>
        {error ? (
          <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}

        {!selectedCategory ? (
          <p className="text-sm text-[var(--color-charcoal-muted)]">
            {categories.length === 0 ? "Create a category to start building the menu." : "Select a category."}
          </p>
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{selectedCategory.name}</h2>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setEditingItemId("new")}
                  className="rounded-md bg-[var(--color-bronze)] px-3 py-1.5 text-sm font-medium text-white"
                >
                  + New item
                </button>
              ) : null}
            </div>

            {editingItemId === "new" ? (
              <div className="mb-4">
                <MenuItemEditor
                  mode="create"
                  categoryId={selectedCategory.id}
                  currency={currency}
                  isAdmin={isAdmin}
                  onSaved={(item) => applyMenuItemChange(selectedCategory.id, item, true)}
                  onCancel={() => setEditingItemId(null)}
                  onDeleted={() => setEditingItemId(null)}
                />
              </div>
            ) : null}

            <ul className="flex flex-col gap-2">
              {[...selectedCategory.items]
                .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
                .map((item, index, sortedItems) =>
                  editingItemId === item.id ? (
                    <li key={item.id}>
                      <MenuItemEditor
                        mode="edit"
                        item={item}
                        categoryId={selectedCategory.id}
                        currency={currency}
                        isAdmin={isAdmin}
                        onSaved={(updated) => applyMenuItemChange(selectedCategory.id, updated, false)}
                        onCancel={() => setEditingItemId(null)}
                        onDeleted={() => handleItemDeleted(selectedCategory.id, item.id)}
                      />
                    </li>
                  ) : (
                    <li key={item.id} className={`${cardClass} flex items-center gap-3 p-3`}>
                      <div className="flex flex-1 flex-wrap items-baseline gap-2">
                        <span className={`font-medium ${item.isActive ? "" : "text-[var(--color-charcoal-muted)] italic"}`}>
                          {item.name}
                        </span>
                        <span className="tabular-nums text-sm text-[var(--color-charcoal-muted)]">
                          {formatMoney(item.priceCents, currency)}
                        </span>
                        {!item.isActive ? <Badge tone="muted">Inactive</Badge> : null}
                        {!item.isAvailable ? <Badge tone="warning">Unavailable</Badge> : null}
                        {item.isFeatured ? <Badge tone="accent">Featured</Badge> : null}
                        {item.optionGroups.length > 0 ? (
                          <Badge tone="muted">
                            {item.optionGroups.length} option group{item.optionGroups.length === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </div>

                      <label className="flex items-center gap-1.5 text-xs text-[var(--color-charcoal-muted)]">
                        Available
                        <input
                          type="checkbox"
                          checked={item.isAvailable}
                          disabled={isPending}
                          onChange={(e) => handleToggleAvailability(item.id, e.target.checked)}
                          className="h-4 w-4 accent-[var(--color-bronze)]"
                          aria-label={`${item.name} available`}
                        />
                      </label>

                      {isAdmin ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            disabled={isPending || index === 0}
                            onClick={() => {
                              const neighbor = sortedItems[index - 1]!;
                              startTransition(async () => {
                                const result = await reorderMenuItem({ id: item.id, direction: "up" });
                                if (!result.ok) {
                                  fail(result.message);
                                  return;
                                }
                                handleReorderItem(selectedCategory.id, item.id, item.sortOrder, neighbor.id, neighbor.sortOrder);
                              });
                            }}
                            className={smallButtonClass}
                            aria-label={`Move ${item.name} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={isPending || index === sortedItems.length - 1}
                            onClick={() => {
                              const neighbor = sortedItems[index + 1]!;
                              startTransition(async () => {
                                const result = await reorderMenuItem({ id: item.id, direction: "down" });
                                if (!result.ok) {
                                  fail(result.message);
                                  return;
                                }
                                handleReorderItem(selectedCategory.id, item.id, item.sortOrder, neighbor.id, neighbor.sortOrder);
                              });
                            }}
                            className={smallButtonClass}
                            aria-label={`Move ${item.name} down`}
                          >
                            ↓
                          </button>
                          <button type="button" onClick={() => setEditingItemId(item.id)} className={smallButtonClass}>
                            Edit
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ),
                )}
              {selectedCategory.items.length === 0 && editingItemId !== "new" ? (
                <p className="text-sm text-[var(--color-charcoal-muted)]">No items in this category yet.</p>
              ) : null}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function Badge({ tone, children }: { tone: "muted" | "warning" | "accent"; children: React.ReactNode }) {
  const toneClass =
    tone === "warning"
      ? "bg-amber-100 text-amber-800"
      : tone === "accent"
        ? "bg-[var(--color-bronze)]/15 text-[var(--color-bronze-strong)]"
        : "bg-[var(--color-border)] text-[var(--color-charcoal-muted)]";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>{children}</span>;
}

function RenameForm({ initialName, onSave, onCancel }: { initialName: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialName);
  return (
    <div className="flex gap-1 px-2 py-1">
      <input
        type="text"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(name);
          if (e.key === "Escape") onCancel();
        }}
        className={`${inputClass} py-1`}
      />
      <button type="button" onClick={() => onSave(name)} className={smallButtonClass}>
        Save
      </button>
      <button type="button" onClick={onCancel} className={smallButtonClass}>
        ✕
      </button>
    </div>
  );
}
