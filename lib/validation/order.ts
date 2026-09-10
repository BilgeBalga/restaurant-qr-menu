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
