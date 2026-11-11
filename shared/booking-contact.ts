/** E.164 as the contract normalises it (display/validation only; the server re-normalises):
 *  Martinique 0696/0697 → +596…, metropolitan 06/07 → +33…, international « + » kept. */
export function normalizeBookingPhone(input: string): string | null {
  const raw = input.replace(/[\s.()-]/g, "");
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;
  if (/^069[67][0-9]{6}$/.test(raw)) return `+596${raw.slice(1)}`;
  if (/^0[67][0-9]{8}$/.test(raw)) return `+33${raw.slice(1)}`;
  return null;
}
