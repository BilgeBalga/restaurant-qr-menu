"use client";

import { useActionState } from "react";
import { signInWithPassword } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/errors";

const initialState: ActionResult<null> | null = null;

export default function StaffLoginPage() {
  const [state, formAction, isPending] = useActionState(signInWithPassword, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form action={formAction} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Staff sign in</h1>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory-raised)] px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory-raised)] px-3 py-2 text-sm"
          />
        </div>

        {state && !state.ok && (
          <p role="alert" className="text-sm text-red-700">
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-[var(--color-bronze)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
