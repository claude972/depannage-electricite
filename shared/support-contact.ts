const INTERNATIONAL_PHONE = /^\+[1-9][0-9]{6,14}$/;

export const SUPPORT_CONTACT = {
  phone: { label: "Appelez-nous", unavailable: "Le numéro d’assistance n’est pas disponible pour le moment." },
  whatsapp: { label: "WhatsApp", unavailable: "Le contact WhatsApp n’est pas encore disponible." },
} as const;

export function supportContactHref(channel: keyof typeof SUPPORT_CONTACT, number?: string | null): string | null {
  const phone = number?.trim();
  if (!phone || !INTERNATIONAL_PHONE.test(phone)) return null;
  return channel === "phone" ? `tel:${phone}` : `https://wa.me/${phone.slice(1)}`;
}
