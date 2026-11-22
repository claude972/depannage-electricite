import type { Metadata } from "next";
import { PublicInfoPage } from "@/components/role/public-site";

// Real route for the public « Mentions légales » page (same view as `/#legal`), so the address itself answers.
export const metadata: Metadata = {
  title: "Mentions légales — Dépannage électrique",
  description: "Identité de l’exploitant de la plateforme, hébergeur, propriété intellectuelle et données personnelles.",
  alternates: { canonical: "/mentions-legales" },
};

export default function Page() {
  return <PublicInfoPage view="legal" />;
}
