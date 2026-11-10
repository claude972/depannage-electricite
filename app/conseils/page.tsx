import type { Metadata } from "next";
import { PublicAdvice } from "../../components/role/public-advice";

export const metadata: Metadata = {
  title: "Le blog du dépannage — Dépannage électrique",
  description: "Des conseils pour décrire une panne, lire un devis et préparer votre rendez-vous.",
};

export default function Page() {
  return <PublicAdvice />;
}
