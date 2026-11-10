import type { Metadata } from "next";
import { PublicCatalogue } from "@/components/role/public-service-list";

export const metadata: Metadata = {
  title: "Catalogue — Dépannage électrique",
  description: "Retrouvez les interventions de dépannage électrique et leurs estimations indicatives.",
};

export default function Page() {
  return <PublicCatalogue />;
}
