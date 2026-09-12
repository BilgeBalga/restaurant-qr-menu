import { z } from "zod";

/**
 * Shape only, not authority — the create_order RPC re-validates and
 * re-prices everything server-side regardless (§9/§26). This exists so a
 * malformed request is rejected with a clear message before it ever
 * reaches Postgres, not to establish trust in the values themselves.
 */
export const cartItemInputSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  optionChoiceIds: z.array(z.string().uuid()).default([]),
  lineNote: z.string().trim().max(280).optional(),
});

export const createOrderInputSchema = z.object({
  tableId: z.string().uuid(),
  items: z.array(cartItemInputSchema).min(1),
  customerNote: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(16).max(128),
});

export type CartItemInput = z.infer<typeof cartItemInputSchema>;
export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

export const setOrderStatusInputSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(["new", "preparing", "ready", "completed", "cancelled"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * Staff order history filters — fed directly from a page's raw URL
 * `searchParams` (all strings, possibly missing/garbage), so every field
 * has a safe fallback via `.catch()` rather than rejecting the request.
 * `status` omitted means "both completed and cancelled."
 */
export const orderHistoryFiltersSchema = z.object({
  status: z
    .enum(["completed", "cancelled"])
    .optional()
    .catch(undefined),
  range: z.enum(["today", "last7", "last30", "all"]).catch("all").default("all"),
  tableId: z.string().uuid().optional().catch(undefined),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export type OrderHistoryFilters = z.infer<typeof orderHistoryFiltersSchema>;
