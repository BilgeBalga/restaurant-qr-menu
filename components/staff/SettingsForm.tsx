"use client";

import { useState, useTransition, type FormEvent } from "react";
import { updateRestaurantSettings, type RestaurantSettingsView } from "@/app/actions/settings";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/format/money";

/** Falls back to a plain text field if the runtime doesn't support Intl.supportedValuesOf (older browsers). */
const TIMEZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

const inputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-3 py-2 text-sm focus:border-[var(--color-bronze)] focus:outline-none";
const labelClass = "text-sm font-medium text-[var(--color-charcoal)]";

export function SettingsForm({ initial }: { initial: RestaurantSettingsView }) {
  const [values, setValues] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  function set<K extends keyof RestaurantSettingsView>(key: K, value: RestaurantSettingsView[K]) {
    setError(null);
    setJustSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setJustSaved(false);
    startTransition(async () => {
      const result = await updateRestaurantSettings({
        name: values.name,
        // Safe: the <select> below only ever offers SUPPORTED_CURRENCIES options.
        currency: values.currency as SupportedCurrency,
        timezone: values.timezone,
        orderingEnabled: values.orderingEnabled,
        taxRatePercent: values.taxRatePercent,
        serviceChargeRatePercent: values.serviceChargeRatePercent,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      setValues(result.data);
      setJustSaved(true);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-5">
        <h2 className="mb-4 font-semibold">General</h2>
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="settings-name" className={labelClass}>
              Restaurant name
            </label>
            <input
              id="settings-name"
              type="text"
              required
              maxLength={200}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="settings-currency" className={labelClass}>
                Currency
              </label>
              <select
                id="settings-currency"
                value={values.currency}
                onChange={(e) => set("currency", e.target.value)}
                className={inputClass}
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="settings-timezone" className={labelClass}>
                Timezone
              </label>
              {TIMEZONES.length > 0 ? (
                <select
                  id="settings-timezone"
                  value={values.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                  className={inputClass}
                >
                  {TIMEZONES.includes(values.timezone) ? null : <option value={values.timezone}>{values.timezone}</option>}
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="settings-timezone"
                  type="text"
                  required
                  placeholder="e.g. Europe/Berlin"
                  value={values.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                  className={inputClass}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-5">
        <h2 className="mb-4 font-semibold">Pricing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="settings-tax" className={labelClass}>
              Tax rate (%)
            </label>
            <input
              id="settings-tax"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.01}
              value={values.taxRatePercent}
              onChange={(e) => set("taxRatePercent", e.target.valueAsNumber || 0)}
              className={`${inputClass} tabular-nums`}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="settings-service-charge" className={labelClass}>
              Service charge (%)
            </label>
            <input
              id="settings-service-charge"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.01}
              value={values.serviceChargeRatePercent}
              onChange={(e) => set("serviceChargeRatePercent", e.target.valueAsNumber || 0)}
              className={`${inputClass} tabular-nums`}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--color-charcoal-muted)]">Applied to every new order&apos;s subtotal at checkout.</p>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-5">
        <h2 className="mb-3 font-semibold">Ordering</h2>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Accepting orders</span>
            <span className="block text-xs text-[var(--color-charcoal-muted)]">
              Turn off to pause new orders — customers can still browse the menu.
            </span>
          </span>
          <input
            type="checkbox"
            checked={values.orderingEnabled}
            onChange={(e) => set("orderingEnabled", e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--color-bronze)]"
            aria-label="Accepting orders"
          />
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-[var(--color-bronze)] px-5 py-3 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {justSaved && !error ? (
          <p role="status" className="text-sm text-emerald-700">
            Settings saved.
          </p>
        ) : null}
      </div>
    </form>
  );
}
