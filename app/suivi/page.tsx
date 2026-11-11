import type { Metadata } from "next";
import { AccountLookupPage } from "@/components/role/account-lookup-page";

export const metadata: Metadata = {
  title: "Suivre ma demande — Dépannage électrique",
  description: "Connectez-vous à votre compte pour retrouver une intervention avec son numéro de commande.",
};

export default function Page() {
  return <AccountLookupPage />;
}
