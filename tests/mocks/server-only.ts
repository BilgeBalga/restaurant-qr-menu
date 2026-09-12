// Stub for the `server-only` package under plain Vitest (no Next.js RSC
// compiler present here, unlike the real build): the real package throws
// unconditionally on import specifically to fail a Client Component build
// that pulls in server-only code — a check that's meaningless outside
// Next's own bundler and would otherwise block unit-testing any module
// that (correctly) guards itself with `import "server-only"`.
export {};
