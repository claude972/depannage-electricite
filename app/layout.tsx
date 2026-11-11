import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { BRAND_NAME } from "@/lib/brand";
import "./globals.css";
import { PwaRegistration } from "@/components/pwa-registration";
import { ThemeProvider } from "@/components/app/theme-provider";
import { THEME_INIT_SCRIPT } from "@/components/app/theme";

// Plus Jakarta Sans, self-hosted (OFL 1.1 — see app/fonts/OFL.txt and PROVENANCE.md). Exposed as
// the CSS variable --font-jakarta only: no global font change until a screen opts in (.ui-v2).
const jakarta = localFont({
  src: [
    { path: "./fonts/plus-jakarta-sans-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-500.ttf", weight: "500", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-700.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-jakarta",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: `${BRAND_NAME} — Dépannage électrique`,
  description:
    "Votre demande, votre devis et votre intervention électrique, au même endroit.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  applicationName: BRAND_NAME,
  appleWebApp: { capable: true, statusBarStyle: "default", title: BRAND_NAME },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Neutral per system scheme, aligned with the manifest and THEME_COLOR (components/app/theme.ts).
  // Themed surfaces override every variant with the explicit choice while mounted.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#121417" },
  ],
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning on <html> ONLY: the static script below sets data-ui-theme before
    // hydration, which React would otherwise report as an extra attribute. Children are unaffected.
    <html lang="fr" className={jakarta.variable} suppressHydrationWarning>
      <head>
        {/* Static anti-flash script (no interpolation): only sets data-ui-theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Aller au contenu
        </a>
        <PwaRegistration />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
