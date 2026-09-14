"use client";

import { useCallback, useState, useTransition } from "react";
import {
  addStaffMember,
  listStaffMembers,
  setStaffActive,
  updateStaffRole,
  type StaffMemberView,
} from "@/app/actions/staffAdmin";
import type { StaffRole } from "@/lib/business/orderStateMachine";
import type { AssignableStaffRole } from "@/lib/validation/staff";

/**
 * Assignable roles only — manager/kitchen have no transition rights in
 * lib/business/orderStateMachine.ts, so offering them here would let an
 * admin hand someone order-management UI that silently fails on every
 * click. Typed against AssignableStaffRole (lib/validation/staff.ts) so
 * this list and the server-side schema can't drift apart unnoticed.
 */
const ASSIGNABLE_ROLE_OPTIONS: { value: AssignableStaffRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
];

function isAssignableRole(role: StaffRole): role is AssignableStaffRole {
  return ASSIGNABLE_ROLE_OPTIONS.some((opt) => opt.value === role);
}

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  kitchen: "Kitchen",
};

const inputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-3 py-2 text-sm focus:border-[var(--color-bronze)] focus:outline-none";
const smallButtonClass = "rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-ivory)] disabled:opacity-40";

export function StaffManager({ initialMembers }: { initialMembers: StaffMemberView[] }) {
  const [members, setMembers] = useState(initialMembers);
  const [creating, setCreating] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<{ email: string; password: string } | null>(null);

  const refetch = useCallback(async () => {
    const result = await listStaffMembers();
    if (result.ok) {
      setMembers(result.data);
      setListError(null);
    } else {
      setListError(result.message);
    }
  }, []);

  const active = members.filter((m) => m.isActive);
  const inactive = members.filter((m) => !m.isActive);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Staff</h1>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-md bg-[var(--color-bronze)] px-3 py-1.5 text-sm font-medium text-white"
        >
          {creating ? "Cancel" : "+ Add staff"}
        </button>
      </div>

      {creating ? (
        <AddStaffForm
          onAdded={(password, email) => {
            setCreating(false);
            if (password) setTemporaryPassword({ email, password });
            void refetch();
          }}
        />
      ) : null}

      {temporaryPassword ? (
        <div className="mb-4 rounded-lg border border-[var(--color-bronze)] bg-[var(--color-ivory-raised)] p-4 text-sm">
          <p className="font-medium">
            Account created for {temporaryPassword.email}. Share this temporary password with them directly — it won&apos;t be shown
            again:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-[var(--color-ivory)] px-2 py-1 font-mono text-sm">{temporaryPassword.password}</code>
            <button
              type="button"
              className={smallButtonClass}
              onClick={() => void navigator.clipboard.writeText(temporaryPassword.password)}
            >
              Copy
            </button>
            <button type="button" className={smallButtonClass} onClick={() => setTemporaryPassword(null)}>
              Dismiss
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-charcoal-muted)]">
            There&apos;s no self-service password reset yet — they can sign in with this password at /staff/login.
          </p>
        </div>
      ) : null}

      {listError ? <p className="mb-4 text-sm text-red-700">{listError}</p> : null}

      <StaffTable title="Active" members={active} onChanged={refetch} />
      {inactive.length > 0 ? <StaffTable title="Inactive" members={inactive} onChanged={refetch} className="mt-6" /> : null}
    </div>
  );
}

function AddStaffForm({ onAdded }: { onAdded: (temporaryPassword: string | null, email: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableStaffRole>("staff");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await addStaffMember({ email, role });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const addedEmail = email;
      setEmail("");
      setRole("staff");
      onAdded(result.data.temporaryPassword, addedEmail);
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[var(--color-border)] p-3">
      <div className="flex-1" style={{ minWidth: 220 }}>
        <label className="text-xs text-[var(--color-charcoal-muted)]">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@restaurant.com"
          className={inputClass}
        />
      </div>
      <div className="w-40">
        <label className="text-xs text-[var(--color-charcoal-muted)]">Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as AssignableStaffRole)} className={inputClass}>
          {ASSIGNABLE_ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <button type="button" disabled={isPending || !email.trim()} onClick={handleSubmit} className={smallButtonClass}>
        Add
      </button>
      {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function StaffTable({
  title,
  members,
  onChanged,
  className = "",
}: {
  title: string;
  members: StaffMemberView[];
  onChanged: () => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-charcoal-muted)]">
        {title} ({members.length})
      </h2>
      {members.length === 0 ? (
        <p className="text-sm text-[var(--color-charcoal-muted)]">Nobody here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-charcoal-muted)]">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Added</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <StaffRow key={member.membershipId} member={member} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StaffRow({ member, onChanged }: { member: StaffMemberView; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // member.role may already be "manager"/"kitchen" (assigned before this
  // restriction, or written directly at the DB layer) — never drop it
  // from the row's own options, so the select keeps showing their actual
  // current role instead of appearing blank, without making it
  // re-assignable to anyone else.
  const rowRoleOptions = ASSIGNABLE_ROLE_OPTIONS.some((opt) => opt.value === member.role)
    ? ASSIGNABLE_ROLE_OPTIONS
    : [{ value: member.role, label: ROLE_LABEL[member.role] }, ...ASSIGNABLE_ROLE_OPTIONS];

  function handleRoleChange(nextRole: StaffRole) {
    if (nextRole === member.role) return;
    // Only reachable in practice if member.role is itself unassignable
    // (manager/kitchen) and its own stub option gets re-selected, which
    // the equality check above already caught — this is a type-narrowing
    // guard, not a real runtime path, since ASSIGNABLE_ROLE_OPTIONS is the
    // only source of *other* options in rowRoleOptions.
    if (!isAssignableRole(nextRole)) return;
    const warning =
      member.role === "admin" && nextRole !== "admin"
        ? `Change ${member.email}${member.isSelf ? " (you)" : ""} from Admin to ${ROLE_LABEL[nextRole]}? ${
            member.isSelf ? "You will lose admin access immediately. " : ""
          }This can't be undone by them.`
        : `Change ${member.email}'s role to ${ROLE_LABEL[nextRole]}?`;
    if (!window.confirm(warning)) return;

    setError(null);
    startTransition(async () => {
      const result = await updateStaffRole({ membershipId: member.membershipId, role: nextRole });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged();
    });
  }

  function handleToggleActive() {
    const next = !member.isActive;
    const warning = next
      ? `Reactivate ${member.email}? They'll regain access immediately.`
      : `Deactivate ${member.email}${member.isSelf ? " (you)" : ""}? ${
          member.isSelf ? "You will lose access immediately. " : ""
        }They'll be signed out of staff access until reactivated.`;
    if (!window.confirm(warning)) return;

    setError(null);
    startTransition(async () => {
      const result = await setStaffActive({ membershipId: member.membershipId, isActive: next });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged();
    });
  }

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="px-4 py-3">
        {member.email}
        {member.isSelf ? <span className="ml-1 text-xs text-[var(--color-charcoal-muted)]">(you)</span> : null}
        {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      </td>
      <td className="px-4 py-3">
        <select
          value={member.role}
          disabled={isPending}
          onChange={(e) => handleRoleChange(e.target.value as StaffRole)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-2 py-1 text-xs focus:border-[var(--color-bronze)] focus:outline-none disabled:opacity-40"
        >
          {rowRoleOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            member.isActive
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-[var(--color-border)] bg-[var(--color-ivory)] text-[var(--color-charcoal-muted)]"
          }`}
        >
          {member.isActive ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-4 py-3 text-[var(--color-charcoal-muted)]">{new Date(member.createdAt).toLocaleDateString()}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          disabled={isPending}
          onClick={handleToggleActive}
          className={`${smallButtonClass} ${member.isActive ? "text-red-700" : ""}`}
        >
          {member.isActive ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  );
}
