// /suivi (docs/GUEST_CHECKOUT_CONTRACT.md): find one's requests again with a verified phone.
// No public lookup by name or phone: nothing is listed before the code is verified.
import type { Metadata } from "next";
import { PhoneLookupPage } from "@/components/role/phone-access";

export const metadata: Metadata = {
  title: "Suivre ma demande — Courant",
  description: "Retrouvez vos demandes avec votre téléphone vérifié par un code.",
};

export default function Page() {
  return <PhoneLookupPage />;
}
