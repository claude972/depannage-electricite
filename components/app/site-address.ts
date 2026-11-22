// A site stores one free-text address (« 12 rue des Ateliers, 97200 Fort-de-France »). The request
// wizard needs street / postal code / city: this splits what can be recognised and never invents the
// rest — an address without a recognisable postal code prefills the street line only.
export type SiteAddressParts = { address: string; postal_code: string; city: string };

export function siteAddressParts(raw: string | null | undefined): SiteAddressParts | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  // Last 5-digit group followed by a city name: « <street>[,] <postal code> <city> ».
  const match = /^(.*?)[\s,;-]*\b(\d{5})\b[\s,]+([^\d,;]+?)[\s,;.]*$/.exec(text);
  if (match && match[1].trim()) {
    return { address: match[1].replace(/[\s,;-]+$/, "").trim(), postal_code: match[2], city: match[3].trim() };
  }
  return { address: text, postal_code: "", city: "" };
}
