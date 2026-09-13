"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { listPlatformRestaurants, provisionRestaurant, type PlatformRestaurantRow, type RestaurantStatus } from "@/app/actions/platformAdmin";
import { SUPPORTED_CURRENCIES } from "@/lib/format/money";

/** Falls back to a plain text field if the runtime doesn't support Intl.supportedValuesOf — same fallback SettingsForm.tsx already uses. */
const TIMEZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

const STATUS_BADGE: Record<RestaurantStatus, string> = {
  provisioning: "border-[var(--color-border)] bg-[var(--color-ivory)] text-[var(--color-charcoal-muted)]",
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  suspended: "border-amber-200 bg-amber-50 text-amber-800",
  archived: "border-[var(--color-border)] bg-[var(--color-ivory)] text-[var(--color-charcoal-muted)]",
};

const inputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-3 py-2 text-sm focus:border-[var(--color-bronze)] focus:outline-none";
const labelClass = "text-xs text-[var(--color-charcoal-muted)]";
const smallButtonClass = "rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-ivory)] disabled:opacity-40";

/**
 * Platform-admin restaurant list + provisioning form — deliberately no
 * status-changing controls yet (Phase 5+). Mirrors StaffManager.tsx's
 * shape closely (collapsible create form, temporary-password reveal
 * banner, refetch-after-mutate) since it's the closest existing analog:
 * platform-admin-only creation of a new identity-bearing entity with the
 * same temporary-password onboarding story.
 */
export function RestaurantManager({ initialRestaurants }: { initialRestaurants: PlatformRestaurantRow[] }) {
  const [restaurants, setRestaurants] = useState(initialRestaurants);
  const [creating, setCreating] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [ownerCredential, setOwnerCredential] = useState<{ email: string; password: string } | null>(null);

  const refetch = useCallback(async () => {
    const result = await listPlatformRestaurants();
    if (result.ok) {
      setRestaurants(result.data);
      setListError(null);
    } else {
      setListError(result.message);
    }
  }, []);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Restaurants</h1>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-md bg-[var(--color-bronze)] px-3 py-1.5 text-sm font-medium text-white"
        >
          {creating ? "Cancel" : "+ New restaurant"}
        </button>
      </div>

      {creating ? (
        <ProvisionRestaurantForm
          onProvisioned={(password, email) => {
            setCreating(false);
            if (password) setOwnerCredential({ email, password });
            void refetch();
          }}
        />
      ) : null}

      {ownerCredential ? (
        <div className="mb-4 rounded-lg border border-[var(--color-bronze)] bg-[var(--color-ivory-raised)] p-4 text-sm">
          <p className="font-medium">
            Owner account created for {ownerCredential.email}. Share this temporary password with them directly — it won&apos;t be
            shown again:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-[var(--color-ivory)] px-2 py-1 font-mono text-sm">{ownerCredential.password}</code>
            <button type="button" className={smallButtonClass} onClick={() => void navigator.clipboard.writeText(ownerCredential.password)}>
              Copy
            </button>
            <button type="button" className={smallButtonClass} onClick={() => setOwnerCredential(null)}>
              Dismiss
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-charcoal-muted)]">
            There&apos;s no self-service password reset yet — they can sign in with this password at /staff/login.
          </p>
        </div>
      ) : null}

      {listError ? <p className="mb-4 text-sm text-red-700">{listError}</p> : null}

      {restaurants.length === 0 ? (
        <p className="text-sm text-[var(--color-charcoal-muted)]">No restaurants yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-charcoal-muted)]">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Currency</th>
                <th className="px-4 py-3 font-medium">Timezone</th>
                <th className="px-4 py-3 font-medium">Ordering</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {restaurants.map((restaurant) => (
                <tr key={restaurant.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/platform/restaurants/${restaurant.slug}`} className="text-[var(--color-bronze-strong)] hover:underline">
                      {restaurant.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-charcoal-muted)]">{restaurant.slug}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[restaurant.status]}`}>
                      {restaurant.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-charcoal-muted)]">{restaurant.ownerEmail ?? "—"}</td>
                  <td className="px-4 py-3">{restaurant.currency}</td>
                  <td className="px-4 py-3 text-[var(--color-charcoal-muted)]">{restaurant.timezone}</td>
                  <td className="px-4 py-3">{restaurant.orderingEnabled ? "On" : "Off"}</td>
                  <td className="px-4 py-3 text-[var(--color-charcoal-muted)]">{new Date(restaurant.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProvisionRestaurantForm({ onProvisioned }: { onProvisioned: (temporaryPassword: string | null, ownerEmail: string) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [currency, setCurrency] = useState<(typeof SUPPORTED_CURRENCIES)[number]>("USD");
  const [orderNumberPrefix, setOrderNumberPrefix] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await provisionRestaurant({
        name,
        slug,
        timezone,
        currency,
        ownerEmail,
        orderNumberPrefix: orderNumberPrefix.trim() ? orderNumberPrefix.trim() : undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const submittedOwnerEmail = ownerEmail;
      setName("");
      setSlug("");
      setOrderNumberPrefix("");
      setOwnerEmail("");
      onProvisioned(result.data.ownerTemporaryPassword, submittedOwnerEmail);
    });
  }

  return (
    <div className="mb-4 rounded-lg border border-dashed border-[var(--color-border)] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Restaurant name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Ivory Bistro" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Slug (unique, used in future URLs)</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="the-ivory-bistro"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Currency</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value as (typeof SUPPORTED_CURRENCIES)[number])} className={inputClass}>
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Timezone</label>
          {TIMEZONES.length > 0 ? (
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. Europe/Berlin" className={inputClass} />
          )}
        </div>
        <div>
          <label className={labelClass}>Order number prefix (optional, defaults to &quot;A&quot;)</label>
          <input
            type="text"
            maxLength={4}
            value={orderNumberPrefix}
            onChange={(e) => setOrderNumberPrefix(e.target.value)}
            placeholder="B"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Owner email</label>
          <input
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="owner@restaurant.com"
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={isPending || !name.trim() || !slug.trim() || !ownerEmail.trim()}
          onClick={handleSubmit}
          className={smallButtonClass}
        >
          {isPending ? "Creating…" : "Create restaurant"}
        </button>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}
