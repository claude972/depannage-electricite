import type { Metadata } from "next";
import { PublicInfoPage } from "@/components/role/public-site";

// Real route for the public « Confidentialité » page (same view as `/#privacy`), so the address itself answers.
export const metadata: Metadata = {
  title: "Confidentialité — Dépannage électrique",
  description: "Ce que l’application enregistre, les services tiers utilisés, vos contrôles et vos droits.",
  alternates: { canonical: "/confidentialite" },
};

export default function Page() {
  return <PublicInfoPage view="privacy" />;
}
