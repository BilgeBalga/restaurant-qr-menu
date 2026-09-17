import { describe, expect, it, vi } from "vitest";
import { classifySignInError } from "@/lib/auth/signInError";
import type { AuthError } from "@supabase/supabase-js";

function makeAuthError(overrides: Partial<AuthError>): AuthError {
  return {
    name: "AuthApiError",
    message: "boom",
    status: 400,
    code: undefined,
    ...overrides,
  } as AuthError;
}

describe("classifySignInError", () => {
  it("maps a genuine invalid_credentials response to the user-facing credentials message", () => {
    const error = makeAuthError({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" });

    const result = classifySignInError(error);

    expect(result.code).toBe("UNAUTHENTICATED");
    expect(result.userMessage).toBe("Incorrect email or password.");
  });

  it("never reports a 404 (e.g. a misconfigured project URL) as a credentials error", () => {
    const error = makeAuthError({ status: 404, code: undefined, message: "Not Found" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = classifySignInError(error);

    expect(result.code).toBe("INTERNAL");
    expect(result.userMessage).not.toMatch(/incorrect email or password/i);
    consoleError.mockRestore();
  });

  it("logs the real status/code/message for a non-credentials error, for diagnosability", () => {
    const error = makeAuthError({ status: 500, code: "unexpected_failure", message: "server exploded" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    classifySignInError(error);

    expect(consoleError).toHaveBeenCalledTimes(1);
    const [, payload] = consoleError.mock.calls[0]!;
    expect(payload).toMatchObject({ status: 500, code: "unexpected_failure", message: "server exploded" });
    consoleError.mockRestore();
  });

  it("does not classify a rate-limit response as bad credentials", () => {
    const error = makeAuthError({ status: 429, code: "over_request_rate_limit", message: "rate limited" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = classifySignInError(error);

    expect(result.code).toBe("INTERNAL");
    consoleError.mockRestore();
  });
});
