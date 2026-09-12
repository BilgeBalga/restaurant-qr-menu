"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import {
  createMenuItem,
  createOptionChoice,
  createOptionGroup,
  deleteMenuItem,
  deleteMenuItemImage,
  deleteOptionChoice,
  deleteOptionGroup,
  updateMenuItem,
  updateOptionChoice,
  updateOptionGroup,
  uploadMenuItemImage,
  type AdminMenuItemView,
  type AdminOptionChoiceView,
  type AdminOptionGroupView,
} from "@/app/actions/menuAdmin";
import { centsToInputString, formatMoney } from "@/lib/format/money";
import { ALLOWED_MENU_IMAGE_MIME_TYPES, MAX_MENU_IMAGE_BYTES, isAllowedMenuImageMimeType } from "@/lib/storage/menuImages";
import { MenuItemImage } from "@/components/ui/MenuItemImage";

const inputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-3 py-2 text-sm focus:border-[var(--color-bronze)] focus:outline-none";
const labelClass = "text-xs font-medium text-[var(--color-charcoal-muted)]";
const smallButtonClass = "rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-ivory)] disabled:opacity-40";

interface MenuItemEditorProps {
  mode: "create" | "edit";
  item?: AdminMenuItemView;
  categoryId: string;
  currency: string;
  isAdmin: boolean;
  onSaved: (item: AdminMenuItemView) => void;
  onCancel: () => void;
  onDeleted: () => void;
}

/**
 * One form for base item fields (mode: create or edit) plus, once the
 * item actually has an id (mode "edit" only — a brand-new item has
 * nowhere for option_groups.menu_item_id to point at yet), the nested
 * option-groups/choices editor. Consumes exactly the same
 * option_groups/option_choices records ItemDetail.tsx renders on the
 * customer side — no second options model.
 */
export function MenuItemEditor({ mode, item, categoryId, currency, isAdmin, onSaved, onCancel, onDeleted }: MenuItemEditorProps) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [shortDescription, setShortDescription] = useState(item?.shortDescription ?? "");
  const [priceInput, setPriceInput] = useState(item ? centsToInputString(item.priceCents) : "");
  const [currentImageUrl, setCurrentImageUrl] = useState(item?.imageUrl ?? null);
  const [ingredients, setIngredients] = useState((item?.ingredients ?? []).join(", "));
  const [allergens, setAllergens] = useState((item?.allergens ?? []).join(", "));
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [isAvailable, setIsAvailable] = useState(item?.isAvailable ?? true);
  const [isFeatured, setIsFeatured] = useState(item?.isFeatured ?? false);
  const [optionGroups, setOptionGroups] = useState(item?.optionGroups ?? []);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toTagArray(value: string): string[] {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      if (mode === "create") {
        const result = await createMenuItem({
          categoryId,
          name,
          description: description || undefined,
          shortDescription: shortDescription || undefined,
          priceInput,
          ingredients: toTagArray(ingredients),
          allergens: toTagArray(allergens),
          isFeatured,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onSaved(result.data);
        return;
      }

      const result = await updateMenuItem({
        id: item!.id,
        categoryId,
        name,
        description: description || "",
        shortDescription: shortDescription || "",
        priceInput,
        ingredients: toTagArray(ingredients),
        allergens: toTagArray(allergens),
        isActive,
        isAvailable,
        isFeatured,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved({ ...result.data, optionGroups, imageUrl: currentImageUrl });
    });
  }

  function handleDelete() {
    if (!item) return;
    if (!window.confirm(`Delete "${item.name}"? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteMenuItem({ id: item.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDeleted();
    });
  }

  return (
    <div className="rounded-lg border border-[var(--color-bronze)] bg-[var(--color-ivory-raised)] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <label className={labelClass}>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label className={labelClass}>Short description (menu list)</label>
          <input type="text" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} className={inputClass} />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label className={labelClass}>Full description (item detail)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputClass} />
        </div>

        <div className="space-y-1">
          <label className={labelClass}>Price ({currency})</label>
          <input
            type="text"
            inputMode="decimal"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="12.50"
            className={`${inputClass} tabular-nums`}
          />
        </div>

        <div className="space-y-1">
          <label className={labelClass}>Ingredients (comma-separated)</label>
          <input type="text" value={ingredients} onChange={(e) => setIngredients(e.target.value)} className={inputClass} />
        </div>

        <div className="space-y-1">
          <label className={labelClass}>Allergens (comma-separated)</label>
          <input type="text" value={allergens} onChange={(e) => setAllergens(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <label className={labelClass}>Photo</label>
        {mode === "edit" && item ? (
          <MenuItemPhotoManager
            menuItemId={item.id}
            itemName={name}
            imageUrl={currentImageUrl}
            onChanged={(updated) => {
              setCurrentImageUrl(updated.imageUrl);
              // Propagated immediately, not held back for the main Save button — an
              // image upload/replace/remove is its own complete action (§Image
              // Support), so the parent list should reflect it right away.
              onSaved({ ...updated, optionGroups });
            }}
          />
        ) : (
          <p className="text-xs text-[var(--color-charcoal-muted)]">Save the item first, then add a photo.</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} className="accent-[var(--color-bronze)]" />
          Featured
        </label>
        {mode === "edit" ? (
          <>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} className="accent-[var(--color-bronze)]" />
              Available
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-[var(--color-bronze)]" />
              Active
            </label>
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending || !name.trim() || !priceInput.trim()}
          onClick={handleSave}
          className="rounded-md bg-[var(--color-bronze)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : mode === "create" ? "Create item" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm">
          {mode === "create" ? "Cancel" : "Close"}
        </button>
        {mode === "edit" && isAdmin ? (
          <button type="button" onClick={handleDelete} className="ml-auto rounded-md border border-red-200 px-4 py-2 text-sm text-red-700 hover:bg-red-50">
            Delete item
          </button>
        ) : null}
      </div>

      {mode === "edit" && item ? (
        <div className="mt-5 border-t border-[var(--color-border)] pt-4">
          <h3 className="mb-2 text-sm font-semibold">Option groups</h3>
          <div className="flex flex-col gap-3">
            {[...optionGroups]
              .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
              .map((group) => (
                <OptionGroupEditor
                  key={group.id}
                  group={group}
                  currency={currency}
                  onChanged={(updated) => setOptionGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)))}
                  onDeleted={(id) => setOptionGroups((prev) => prev.filter((g) => g.id !== id))}
                />
              ))}
          </div>
          <NewOptionGroupForm menuItemId={item.id} onCreated={(group) => setOptionGroups((prev) => [...prev, group])} />
        </div>
      ) : null}
      {mode === "create" ? (
        <p className="mt-4 text-xs text-[var(--color-charcoal-muted)]">Save the item first, then add option groups (extras, sizes, etc.).</p>
      ) : null}
    </div>
  );
}

/**
 * Upload/replace/remove is its own immediate, independent action —
 * separate from the item's main Save button — rather than a text field
 * bundled into the general patch (§Image Support: "prefer Storage upload
 * as the primary workflow rather than maintaining two competing
 * mechanisms" — this replaces the old free-text "Image URL" input
 * entirely). Only rendered once the item has an id (mode "edit"), the
 * same constraint the option-groups editor above already has, for the
 * same reason: there's nowhere for the uploaded object's path to point
 * until the item itself exists.
 */
function MenuItemPhotoManager({
  menuItemId,
  itemName,
  imageUrl,
  onChanged,
}: {
  menuItemId: string;
  itemName: string;
  imageUrl: string | null;
  onChanged: (updated: AdminMenuItemView) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be re-selected later (e.g. after fixing it outside the app)
    if (!file) return;

    setError(null);

    // Client-side validation for instant feedback only — never a
    // substitute for the server-side check in uploadMenuItemImage,
    // which re-validates the same File's real type/size regardless.
    if (!isAllowedMenuImageMimeType(file.type)) {
      setError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_MENU_IMAGE_BYTES) {
      setError("Images must be 5MB or smaller.");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    const formData = new FormData();
    formData.set("menuItemId", menuItemId);
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadMenuItemImage(formData);
      URL.revokeObjectURL(objectUrl);
      setPreviewUrl(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged(result.data);
    });
  }

  function handleRemove() {
    if (!window.confirm("Remove this item's photo?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteMenuItemImage({ id: menuItemId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged(result.data);
    });
  }

  const displayUrl = previewUrl ?? imageUrl;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <MenuItemImage
          name={itemName || "?"}
          imageUrl={displayUrl}
          className="h-20 w-20 shrink-0 rounded-md border border-[var(--color-border)]"
          monogramClassName="text-xl"
        />
        <div className="flex flex-col items-start gap-1.5">
          <label className={`${smallButtonClass} cursor-pointer ${isPending ? "pointer-events-none opacity-40" : ""}`}>
            {isPending ? "Uploading…" : imageUrl ? "Replace photo" : "Upload photo"}
            <input
              type="file"
              accept={ALLOWED_MENU_IMAGE_MIME_TYPES.join(",")}
              onChange={handleFileChange}
              disabled={isPending}
              className="hidden"
            />
          </label>
          {imageUrl ? (
            <button type="button" disabled={isPending} onClick={handleRemove} className={`${smallButtonClass} text-red-700`}>
              Remove photo
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-[var(--color-charcoal-muted)]">JPEG, PNG, or WebP — up to 5MB.</p>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function OptionGroupEditor({
  group,
  currency,
  onChanged,
  onDeleted,
}: {
  group: AdminOptionGroupView;
  currency: string;
  onChanged: (group: AdminOptionGroupView) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [selectionType, setSelectionType] = useState(group.selectionType);
  const [isRequired, setIsRequired] = useState(group.isRequired);
  const [minSelect, setMinSelect] = useState(group.minSelect);
  const [maxSelect, setMaxSelect] = useState(group.maxSelect);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateOptionGroup({ id: group.id, name, selectionType, isRequired, minSelect, maxSelect });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged({ ...result.data, choices: group.choices });
      setEditing(false);
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete option group "${group.name}" and all its choices?`)) return;
    startTransition(async () => {
      const result = await deleteOptionGroup({ id: group.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDeleted(group.id);
    });
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] p-3">
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          <select value={selectionType} onChange={(e) => setSelectionType(e.target.value as "single" | "multiple")} className={inputClass}>
            <option value="single">Single choice</option>
            <option value="multiple">Multiple choice</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="accent-[var(--color-bronze)]" />
            Required
          </label>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--color-charcoal-muted)]">Min</label>
            <input type="number" min={0} value={minSelect} onChange={(e) => setMinSelect(e.target.valueAsNumber || 0)} className={`${inputClass} w-20`} />
            <label className="text-xs text-[var(--color-charcoal-muted)]">Max</label>
            <input type="number" min={0} value={maxSelect} onChange={(e) => setMaxSelect(e.target.valueAsNumber || 0)} className={`${inputClass} w-20`} />
          </div>
          {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={isPending} onClick={handleSave} className={smallButtonClass}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={smallButtonClass}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm">
            <span className="font-medium">{group.name}</span>{" "}
            <span className="text-xs text-[var(--color-charcoal-muted)]">
              {group.selectionType === "single" ? "single choice" : "multiple choice"} · min {group.minSelect} / max {group.maxSelect}
              {group.isRequired ? " · required" : ""}
            </span>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => setEditing(true)} className={smallButtonClass}>
              Edit
            </button>
            <button type="button" onClick={handleDelete} className={`${smallButtonClass} text-red-700`}>
              Delete
            </button>
          </div>
        </div>
      )}
      {error && !editing ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}

      <ul className="mt-2 flex flex-col gap-1 border-t border-[var(--color-border)] pt-2">
        {[...group.choices]
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
          .map((choice) => (
            <OptionChoiceRow
              key={choice.id}
              choice={choice}
              currency={currency}
              onChanged={(updated) => onChanged({ ...group, choices: group.choices.map((c) => (c.id === updated.id ? updated : c)) })}
              onDeleted={(id) => onChanged({ ...group, choices: group.choices.filter((c) => c.id !== id) })}
            />
          ))}
      </ul>
      <NewOptionChoiceForm optionGroupId={group.id} onCreated={(choice) => onChanged({ ...group, choices: [...group.choices, choice] })} />
    </div>
  );
}

function OptionChoiceRow({
  choice,
  currency,
  onChanged,
  onDeleted,
}: {
  choice: AdminOptionChoiceView;
  currency: string;
  onChanged: (choice: AdminOptionChoiceView) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(choice.name);
  const [priceDeltaInput, setPriceDeltaInput] = useState(centsToInputString(choice.priceDeltaCents));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateOptionChoice({ id: choice.id, name, priceDeltaInput });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged(result.data);
      setEditing(false);
    });
  }

  function handleToggleAvailable(isAvailable: boolean) {
    startTransition(async () => {
      const result = await updateOptionChoice({ id: choice.id, isAvailable });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged(result.data);
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete choice "${choice.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteOptionChoice({ id: choice.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDeleted(choice.id);
    });
  }

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 py-1">
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} flex-1`} />
        <input
          type="text"
          inputMode="decimal"
          value={priceDeltaInput}
          onChange={(e) => setPriceDeltaInput(e.target.value)}
          className={`${inputClass} w-24 tabular-nums`}
        />
        {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
        <button type="button" disabled={isPending} onClick={handleSave} className={smallButtonClass}>
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className={smallButtonClass}>
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <span className={`flex-1 ${choice.isAvailable ? "" : "text-[var(--color-charcoal-muted)] italic"}`}>{choice.name}</span>
      <span className="tabular-nums text-xs text-[var(--color-charcoal-muted)]">
        {choice.priceDeltaCents === 0
          ? "no charge"
          : `${choice.priceDeltaCents > 0 ? "+" : ""}${formatMoney(choice.priceDeltaCents, currency)}`}
      </span>
      <label className="flex items-center gap-1 text-xs text-[var(--color-charcoal-muted)]">
        Available
        <input type="checkbox" checked={choice.isAvailable} onChange={(e) => handleToggleAvailable(e.target.checked)} className="accent-[var(--color-bronze)]" />
      </label>
      <button type="button" onClick={() => setEditing(true)} className={smallButtonClass}>
        Edit
      </button>
      <button type="button" onClick={handleDelete} className={`${smallButtonClass} text-red-700`}>
        Delete
      </button>
      {error ? <p className="w-full text-red-700">{error}</p> : null}
    </li>
  );
}

function NewOptionGroupForm({ menuItemId, onCreated }: { menuItemId: string; onCreated: (group: AdminOptionGroupView) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectionType, setSelectionType] = useState<"single" | "multiple">("single");
  const [isRequired, setIsRequired] = useState(false);
  const [minSelect, setMinSelect] = useState(0);
  const [maxSelect, setMaxSelect] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm text-[var(--color-bronze-strong)] hover:underline">
        + Add option group
      </button>
    );
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createOptionGroup({ menuItemId, name, selectionType, isRequired, minSelect, maxSelect });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onCreated(result.data);
      setName("");
      setSelectionType("single");
      setIsRequired(false);
      setMinSelect(0);
      setMaxSelect(1);
      setOpen(false);
    });
  }

  return (
    <div className="mt-3 grid gap-2 rounded-md border border-dashed border-[var(--color-border)] p-3 sm:grid-cols-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Size" className={inputClass} />
      <select value={selectionType} onChange={(e) => setSelectionType(e.target.value as "single" | "multiple")} className={inputClass}>
        <option value="single">Single choice</option>
        <option value="multiple">Multiple choice</option>
      </select>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="accent-[var(--color-bronze)]" />
        Required
      </label>
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--color-charcoal-muted)]">Min</label>
        <input type="number" min={0} value={minSelect} onChange={(e) => setMinSelect(e.target.valueAsNumber || 0)} className={`${inputClass} w-20`} />
        <label className="text-xs text-[var(--color-charcoal-muted)]">Max</label>
        <input type="number" min={0} value={maxSelect} onChange={(e) => setMaxSelect(e.target.valueAsNumber || 0)} className={`${inputClass} w-20`} />
      </div>
      {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" disabled={isPending || !name.trim()} onClick={handleCreate} className={smallButtonClass}>
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className={smallButtonClass}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function NewOptionChoiceForm({ optionGroupId, onCreated }: { optionGroupId: string; onCreated: (choice: AdminOptionChoiceView) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [priceDeltaInput, setPriceDeltaInput] = useState("0.00");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs text-[var(--color-bronze-strong)] hover:underline">
        + Add choice
      </button>
    );
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createOptionChoice({ optionGroupId, name, priceDeltaInput });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onCreated(result.data);
      setName("");
      setPriceDeltaInput("0.00");
      setOpen(false);
    });
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Extra cheese" className={`${inputClass} flex-1`} />
      <input
        type="text"
        inputMode="decimal"
        value={priceDeltaInput}
        onChange={(e) => setPriceDeltaInput(e.target.value)}
        className={`${inputClass} w-24 tabular-nums`}
      />
      {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
      <button type="button" disabled={isPending || !name.trim()} onClick={handleCreate} className={smallButtonClass}>
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className={smallButtonClass}>
        Cancel
      </button>
    </div>
  );
}
