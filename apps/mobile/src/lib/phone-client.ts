import { z } from 'zod';
import { api } from './api';

export const phoneNumber = z.string().regex(/^\+[1-9]\d{7,14}$/);
export const phoneCode = z.string().regex(/^\d{6}$/);
export const phonePurpose = z.enum(['booking', 'lookup']);
export type PhonePurpose = z.infer<typeof phonePurpose>;

export function normalizeInternationalPhone(value: string) {
  return phoneNumber.safeParse(value.trim().replace(/[\s().-]/g, '')).data;
}

export function verifiedPhone(user: { phone?: string; phone_confirmed_at?: string } | undefined) {
  if (!user?.phone || !user.phone_confirmed_at || !Number.isFinite(Date.parse(user.phone_confirmed_at))) return undefined;
  return normalizeInternationalPhone(user.phone.startsWith('+') ? user.phone : '+' + user.phone);
}

export const phoneContact = z.object({
  first_name: z.string().trim().min(1, 'Renseignez votre prénom.').max(60),
  last_name: z.string().trim().min(1, 'Renseignez votre nom.').max(60),
  phone: phoneNumber,
}).refine(value => value.first_name.length + value.last_name.length < 120, 'Le prénom et le nom sont trop longs.');
export type PhoneContact = z.infer<typeof phoneContact>;

const challenge = z.object({
  status: z.literal('code_requested'),
  kind: z.literal('sms'),
  retry_after: z.number().int().min(1).max(600),
  phone_suffix: z.string().regex(/^\d{4}$/),
});
const verified = z.object({
  verified: z.literal(true),
  session: z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1) }).strict(),
}).strict();

export async function requestPhoneCode(contact: PhoneContact, purpose: PhonePurpose) {
  const result = await api('/api/auth/phone/start', challenge, { method: 'POST', body: { ...contact, purpose } });
  if (result.phone_suffix !== contact.phone.slice(-4))
    throw new Error('La réponse de vérification ne correspond pas à ce numéro.');
  return result;
}

export async function verifyNativePhoneCode(phone: string, code: string) {
  const result = await api('/api/auth/phone/native/verify', verified, { method: 'POST', body: { phone, token: code, kind: 'sms' } });
  return result.session;
}
