import type { Metadata } from "next";
import { PublicInfoPage } from "@/components/role/public-site";

// Real route for the public « À propos » page (same view as `/#about`), so the address itself answers.
export const metadata: Metadata = {
  title: "À propos — Dépannage électrique",
  description: "Ce que fait l’application de dépannage électrique, son exploitant et les moyens de le contacter.",
  alternates: { canonical: "/a-propos" },
};

export default function Page() {
  return <PublicInfoPage view="about" />;
}
