/** E.164 as the contract normalises it (display/validation only; the server re-normalises):
 *  Martinique 0696/0697 → +596…, Guadeloupe 0690/0691 → +590…, metropolitan 06/07 → +33…,
 *  international « + » kept. Delivered native builds rely on this lenient form. */
export function normalizeBookingPhone(input: string): string | null {
  const raw = input.replace(/[\s.()-]/g, "");
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;
  if (/^069[67][0-9]{6}$/.test(raw)) return `+596${raw.slice(1)}`;
  if (/^069[01][0-9]{6}$/.test(raw)) return `+590${raw.slice(1)}`;
  if (/^0[67][0-9]{8}$/.test(raw)) return `+33${raw.slice(1)}`;
  return null;
}

/** One sentence for every screen and every server answer of the website. */
export const ACCOUNT_PHONE_MESSAGE =
  "Indiquez un numéro de téléphone en +596, +590 ou +33 (ex. 0696 12 34 56 ou +590 690 12 34 56).";

/** Website rule (account and booking contact): only +596, +590 and +33 are accepted.
 *  A local mobile number is completed with its own territory code; a mobile range that belongs
 *  to another territory (Réunion, Guyane, Mayotte) is refused instead of being filed under +33. */
export function normalizeAccountPhone(input: string): string | null {
  if (input.length > 40 || !/^[+\d\s().-]+$/.test(input)) return null;
  let raw = input.replace(/[\s.()-]/g, "");
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  const international = /^\+(596|590|33)0?([1-9][0-9]{8})$/.exec(raw);
  if (international) return `+${international[1]}${international[2]}`;
  if (/^069[67][0-9]{6}$/.test(raw)) return `+596${raw.slice(1)}`;
  if (/^069[01][0-9]{6}$/.test(raw)) return `+590${raw.slice(1)}`;
  if (/^069[234][0-9]{6}$/.test(raw) || /^0639[0-9]{6}$/.test(raw)) return null;
  if (/^0[67][0-9]{8}$/.test(raw)) return `+33${raw.slice(1)}`;
  return null;
}
