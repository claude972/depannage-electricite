import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegistration } from "@/components/pwa-registration";
export const metadata: Metadata = {
  title: "Courant — Dépannage électrique",
  description:
    "Votre demande, votre devis et votre intervention électrique, au même endroit.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  applicationName: "Courant",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Courant" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#102a43",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <a className="skip-link" href="#main">
          Aller au contenu
        </a>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
