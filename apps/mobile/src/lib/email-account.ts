import { z } from 'zod';
import { ACCOUNT_PHONE_MESSAGE, normalizeAccountPhone } from '../../../../shared/booking-contact';

export const accountEmail = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Indiquez une adresse e-mail valide.');

export const accountContact = z.object({
  first_name: z.string().trim().min(1, 'Indiquez votre prénom.').max(60),
  last_name: z.string().trim().min(1, 'Indiquez votre nom.').max(60),
  email: accountEmail,
  phone: z.string().transform((value, ctx) => {
    const phone = normalizeAccountPhone(value);
    if (phone) return phone;
    ctx.addIssue({ code: 'custom', message: ACCOUNT_PHONE_MESSAGE });
    return z.NEVER;
  }),
}).refine(value => value.first_name.length + value.last_name.length < 120, 'Prénom et nom : 120 caractères au plus.');

export type AccountContact = z.infer<typeof accountContact>;

export const accountSignup = accountContact.safeExtend({
  password: z.string().min(10, 'Choisissez un mot de passe de 10 à 128 caractères.').max(128),
});

export const nativeSignupResult = z.object({
  status: z.enum(['confirmation_required', 'sign_in_required']),
}).strict();

export function confirmedAccountEmail(user: { email?: string; email_confirmed_at?: string } | undefined) {
  if (!user?.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) return undefined;
  return accountEmail.safeParse(user.email).data;
}
