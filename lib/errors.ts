/**
 * Error-handling foundation (§28). Every server action wraps its work in
 * one of these, so a raw exception — a Postgres error string, a stack
 * trace — never reaches a customer or staff screen. Server actions return
 * an ActionResult instead of throwing, so the UI always has a typed,
 * user-safe message to render.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "CONFLICT"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;

  constructor(code: ErrorCode, message: string, userMessage: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.userMessage = userMessage;
    this.name = "AppError";
  }
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/**
 * Converts any thrown value into a safe ActionResult. Known AppErrors pass
 * their user-facing message through; anything else is logged (full detail,
 * server-side only — swap for Sentry per §28/§33 once SENTRY_DSN is wired)
 * and replaced with a generic message so internals never leak.
 */
export function toActionResult(error: unknown): { ok: false; code: ErrorCode; message: string } {
  if (error instanceof AppError) {
    return { ok: false, code: error.code, message: error.userMessage };
  }
  // Placeholder until Sentry (§28/§33) is wired.
  console.error("Unhandled server action error:", error);
  return { ok: false, code: "INTERNAL", message: "Something went wrong. Please try again." };
}
