// « Revenir à mon dossier dans l’application mobile » after a payment return: the custom-scheme link
// only makes sense where the native application can be installed. A desktop browser never shows it.
export const MOBILE_RETURN_MAX_WIDTH = 600;

/** True on a phone/tablet user agent, or on a small viewport (an in-app browser may mask its agent). */
export function showsMobileAppReturn(userAgent: string | null | undefined, viewportWidth: number | null | undefined): boolean {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent ?? "")) return true;
  return typeof viewportWidth === "number" && Number.isFinite(viewportWidth) && viewportWidth > 0 && viewportWidth <= MOBILE_RETURN_MAX_WIDTH;
}
