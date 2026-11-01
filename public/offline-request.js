// Canonical bounded PUBLIC draft format, also imported by the online boot helper.
// No network, photos, account data, background sync, queue or automatic submission.
export const PUBLIC_DRAFT_KEY = "courant-request-draft";
export const PUBLIC_DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_RAW = 32768;
const categories = ["outage", "panel", "socket", "lighting", "diagnostic"];
const fields = { description: 4000, address: 500, postal_code: 20, city: 120 };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePublicDraftValues(value) {
  if (!object(value) || Object.keys(value).some(key => !["category", "urgency", "site_id", ...Object.keys(fields)].includes(key)) || !own(value, "category") || !categories.includes(value.category)) return null;
  const result = { category: value.category };
  for (const [name, limit] of Object.entries(fields)) {
    const text = own(value, name) ? value[name] : "";
    if (typeof text !== "string" || text.length > limit) return null;
    result[name] = text;
  }
  const urgency = own(value, "urgency") ? value.urgency : "scheduled";
  if (!["urgent", "scheduled"].includes(urgency)) return null;
  result.urgency = urgency;
  if (own(value, "site_id")) {
    if (typeof value.site_id !== "string" || (value.site_id !== "" && !uuid.test(value.site_id))) return null;
    result.site_id = value.site_id;
  }
  return result;
}
export function readPublicDraft(raw, now = Date.now()) {
  if (typeof raw !== "string" || raw.length > MAX_RAW || !Number.isSafeInteger(now) || now < 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!object(parsed) || Object.keys(parsed).length !== 2 || !own(parsed, "savedAt") || !own(parsed, "values") || !Number.isSafeInteger(parsed.savedAt) || parsed.savedAt < 0 || parsed.savedAt > now + 30000 || now - parsed.savedAt >= PUBLIC_DRAFT_TTL_MS) return null;
    const values = parsePublicDraftValues(parsed.values);
    return values ? { savedAt: parsed.savedAt, values } : null;
  } catch { return null; }
}
export function savePublicDraft(storage, input, now = Date.now()) {
  const values = parsePublicDraftValues(input);
  if (!values || !Number.isSafeInteger(now) || now < 0) return { ok: false, reason: "invalid" };
  const draft = { savedAt: now, values };
  try {
    // Web Storage setItem is atomic on quota/refusal: never remove the previous draft first.
    storage.setItem(PUBLIC_DRAFT_KEY, JSON.stringify(draft));
    return { ok: true, draft };
  } catch { return { ok: false, reason: "unavailable" }; }
}
export function clearPublicDraft(storage) {
  try { storage.removeItem(PUBLIC_DRAFT_KEY); return true; } catch { return false; }
}

function attachOfflineForm() {
  const form = document.getElementById("offline-request-form"), status = document.getElementById("offline-status"), clear = document.getElementById("offline-clear"), resume = document.getElementById("offline-resume");
  if (!(form instanceof HTMLFormElement) || !status || !clear || !resume) return;
  const tell = text => { status.textContent = text; };
  let storage;
  try {
    storage = window.sessionStorage;
    const draft = readPublicDraft(storage.getItem(PUBLIC_DRAFT_KEY));
    if (draft) {
      for (const [name, value] of Object.entries(draft.values)) {
        const control = form.elements.namedItem(name);
        if (control && "value" in control) control.value = value;
      }
      tell("Brouillon local retrouvé dans cet onglet. Il n’a pas été envoyé. Il expire 30 minutes après son dernier enregistrement.");
    } else tell("Aucun brouillon local valide. Enregistrez explicitement vos notes ; rien n’est envoyé.");
  } catch { tell("Stockage local indisponible : rien n’a été enregistré. Gardez vos notes dans ce formulaire ou copiez-les avant de quitter cette page."); }
  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(form), values = {};
    for (const name of ["category", ...Object.keys(fields), "urgency", "site_id"]) if (data.has(name)) values[name] = data.get(name);
    const result = savePublicDraft(storage, values);
    tell(result.ok ? "Brouillon enregistré uniquement dans cet onglet pour 30 minutes. Aucune demande envoyée. Revenez manuellement au formulaire en ligne quand la connexion revient." : result.reason === "invalid" ? "Ces notes ne peuvent pas être conservées : vérifiez le choix de catégorie et les longueurs des champs. Le brouillon précédent est conservé." : "Enregistrement impossible : stockage refusé ou plein. Le brouillon précédent est conservé ; vos nouvelles notes restent dans le formulaire. Copiez-les avant de quitter cette page.");
  });
  clear.addEventListener("click", () => {
    if (clearPublicDraft(storage)) { form.reset(); tell("Brouillon local effacé de cet onglet. Aucune demande n’avait été envoyée."); }
    else tell("Effacement impossible : le stockage local est indisponible. Le brouillon précédent peut encore être présent.");
  });
  const reflectNetwork = () => { resume.setAttribute("aria-disabled", navigator.onLine === false ? "true" : "false"); };
  resume.addEventListener("click", event => {
    if (navigator.onLine === false) { event.preventDefault(); tell("La connexion semble encore indisponible. Rien n’est envoyé ; reprenez manuellement quand elle revient."); }
  });
  window.addEventListener("online", reflectNetwork); window.addEventListener("offline", reflectNetwork); reflectNetwork();
  // HTML stays inert without this module. Enable input only after every handler is installed.
  for (const id of ["offline-fields", "offline-save", "offline-clear"]) {
    const control = document.getElementById(id);
    if (control && "disabled" in control) control.disabled = false;
  }
}
if (typeof window !== "undefined" && typeof document !== "undefined" && window.location.pathname === "/offline-request.html") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachOfflineForm, { once: true });
  else attachOfflineForm();
}
