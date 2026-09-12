import { z } from "zod";

/**
 * Shape only, not authority — same convention as lib/validation/menu.ts.
 * tables_write_admin (db/migrations/0002_rls_policies.sql) and the
 * tables_seats_positive / tables_restaurant_label_unique constraints
 * (db/migrations/0000_init_schema.sql) are the real guarantees.
 */

const labelSchema = z.string().trim().min(1, "Table name is required").max(60, "Keep it under 60 characters");
const seatsValueSchema = z.number().int().min(1, "Must be at least 1").max(50, "Must be 50 or fewer");

export const createTableInputSchema = z.object({
  label: labelSchema,
  seats: seatsValueSchema.optional(),
});

/** seats: omitted = don't touch, null = clear it, number = set it. */
export const updateTableInputSchema = z.object({
  id: z.string().uuid(),
  label: labelSchema.optional(),
  seats: seatsValueSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const deleteTableInputSchema = z.object({
  id: z.string().uuid(),
});

/** Generate/rotate/revoke all key off the table, never a token id or value the client would otherwise have to round-trip. */
export const tableIdInputSchema = z.object({
  tableId: z.string().uuid(),
});

export type CreateTableInput = z.infer<typeof createTableInputSchema>;
export type UpdateTableInput = z.infer<typeof updateTableInputSchema>;
