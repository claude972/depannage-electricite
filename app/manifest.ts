import type { MetadataRoute } from "next";

// Next.js App Router manifest convention:
// https://nextjs.org/docs/app/guides/progressive-web-apps#creating-the-web-app-manifest
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Courant — Dépannage électrique",
    short_name: "Courant",
    description:
      "Vos demandes, devis et interventions électriques. Une connexion est nécessaire pour accéder aux dossiers.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
