import { Inter } from "next/font/google";

/**
 * Stage 2 redesign — Inter for the whole customer experience, matching
 * the Stitch design system. Loaded here (not in the root layout) so it's
 * scoped to /menu, /menu/[itemId], /cart, /order/[accessToken] only —
 * staff/platform screens never see this class and keep the existing
 * Fraunces/Public Sans pair untouched. `font-customer-sans` (globals.css)
 * consumes the `--font-inter` variable this class defines.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} min-h-screen bg-[var(--color-canvas)] font-customer-sans`}>{children}</div>
  );
}
