import { ACCOUNT_PHONE_MESSAGE, normalizeAccountPhone } from "../../../shared/booking-contact";

/** Phone number rules of the server. No authentication and no SMS code lives in this module. */
function normalized(raw: string, martiniqueLandline: boolean): string | null {
  if (raw.length > 40 || !/^[+\d\s().-]+$/.test(raw)) return null;
  let n = raw.trim().replace(/[\s().-]/g, "");
  if (/^069[67]\d{6}$/.test(n) || (martiniqueLandline && /^059[67]\d{6}$/.test(n))) n = "+596" + n.slice(1);
  else if (/^069[01]\d{6}$/.test(n)) n = "+590" + n.slice(1);
  else if (/^0[67]\d{8}$/.test(n)) n = "+33" + n.slice(1);
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}
/** Any E.164 number: the contract of the native builds already delivered. */
export const normalizePhone = (raw: string) => normalized(raw, false);
export const normalizeCallbackPhone = (raw: string) => normalized(raw, true);
/** Website contract: +596, +590 or +33 only. */
export const normalizeWebPhone = normalizeAccountPhone;
export const WEB_PHONE_MESSAGE = ACCOUNT_PHONE_MESSAGE;
/** A request that carries a bearer token comes from a native build; the website uses cookies. */
export const nativeTransport = (request: Request) => request.headers.has("authorization");
