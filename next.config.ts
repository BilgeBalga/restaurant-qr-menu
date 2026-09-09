import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Supabase Storage-hosted menu images are added here in Phase 10 (§19).
    remotePatterns: [],
  },
  turbopack: {
    // Pins the workspace root explicitly — otherwise Turbopack's root
    // inference can be thrown off by an unrelated lockfile higher up the
    // filesystem tree (e.g. one sitting directly in the user's home dir).
    root: import.meta.dirname,
  },
};

export default nextConfig;
