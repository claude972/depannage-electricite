import { z } from "zod";
import type { AddressCandidate, AddressSuggestions } from "./types";
import { nearbyBanUrl, parseNearbyBan } from "../../../shared/ban-nearby";

// IGN geocoding: https://ignf.github.io/cartes.gouv.fr-documentation/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/
// Best-effort budget per warm instance, NOT a distributed/IP quota. IGN's 429 remains authoritative.
// No address, position, IP, request payload or provider error is logged or retained here.
const state = { second: 0, calls: 0, active: 0 };
const headers = { "Cache-Control": "private, no-store" };
const text = z.string().trim().min(1).max(300);
const geometry = z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]) });
const postal = z.string().regex(/^\d{5}$/);
const feature = z.object({ type: z.literal("Feature"), geometry, properties: z.object({ id: text, label: text, name: text, postcode: postal, city: text }) });
const collection = z.object({ type: z.literal("FeatureCollection"), features: z.array(feature).max(5) });
const completion = z.object({
  status: z.literal("OK"),
  results: z.array(z.object({
    country: z.literal("StreetAddress"),
    x: z.number().finite().min(-180).max(180),
    y: z.number().finite().min(-90).max(90),
    zipcode: postal,
    city: text,
    fulltext: text,
  })).max(5),
});
const query = z.string().trim().min(3).max(200).refine(v => !/[\x00-\x1f\x7f]/.test(v));
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const coordinate = (s: string | null, bound: number) => s !== null && s.length <= 32 && decimal.test(s) && Number.isFinite(Number(s)) && Math.abs(Number(s)) <= bound;
const failure = (status: number, message: string) => Response.json({ message, retryable: status !== 400 }, { status, headers: { ...headers, ...(status === 400 ? {} : { "Retry-After": "2" }) } });

async function boundedJson(response: Response) {
  if (!response.body) throw Error("empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length; if (length > 128000) throw Error("size");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchJson(url: URL, fetcher: typeof fetch, timeout: number, requestSignal: AbortSignal) {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(timeout)]);
  signal.throwIfAborted();
  const response = await fetcher(url, { cache: "no-store", redirect: "error", signal, headers: { Accept: "application/json" } });
  return { status: response.status, body: response.ok ? await boundedJson(response) : null };
}

// IGN publishes completion separately from direct geocoding. It returns a full
// address label, including the house number when available, but no feature id.
// https://ignf.github.io/geoportal-access-lib/latest/jsdoc/module-Services.html
function completionCandidates(body: unknown): AddressCandidate[] {
  return completion.parse(body).results.map((result, index) => {
    const { fulltext, zipcode, city, x, y } = result;
    const suffix = `, ${zipcode} ${city}`;
    const address = fulltext.endsWith(suffix) ? fulltext.slice(0, -suffix.length).trim() : "";
    if (!address) throw Error("invalid IGN completion label");
    return { id: `completion:${index}:${zipcode}:${x}:${y}`, label: fulltext, address, postal_code: zipcode, city, longitude: x, latitude: y };
  });
}

export async function addressResponse(request: Request, mode: "search" | "reverse", fetcher: typeof fetch = fetch): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const allowed = mode === "search" ? ["q"] : ["lat", "lon"];
  if ([...params.keys()].some(k => !allowed.includes(k)) || allowed.some(k => params.getAll(k).length !== 1)) return failure(400, "Vérifiez les paramètres de recherche d’adresse.");
  const url = new URL(`https://data.geopf.fr/geocodage/${mode}`);
  url.searchParams.set("index", "address"); url.searchParams.set("limit", "5");
  if (mode === "search") {
    const parsed = query.safeParse(params.get("q"));
    if (!parsed.success) return failure(400, "Saisissez une adresse entre 3 et 200 caractères.");
    url.searchParams.set("q", parsed.data);
  } else {
    if (!coordinate(params.get("lat"), 90) || !coordinate(params.get("lon"), 180)) return failure(400, "La position fournie est invalide.");
    url.searchParams.set("lat", String(Number(params.get("lat")))); url.searchParams.set("lon", String(Number(params.get("lon"))));
  }
  const second = Math.floor(Date.now() / 1000);
  if (state.second !== second) { state.second = second; state.calls = 0; }
  if (state.calls >= 10 || state.active >= 4) return failure(429, "La recherche est très sollicitée. Réessayez dans un instant ou saisissez l’adresse manuellement.");
  state.calls++; state.active++;
  try {
    let candidates: AddressCandidate[];
    try {
      const { status, body } = await fetchJson(url, fetcher, 5000, request.signal);
      if (status === 429) return failure(429, "Le service d’adresses est très sollicité. Réessayez dans un instant.");
      const parsed = collection.parse(body);
      candidates = parsed.features.map(f => ({ id: f.properties.id, label: f.properties.label, address: f.properties.name, postal_code: f.properties.postcode, city: f.properties.city, longitude: f.geometry.coordinates[0], latitude: f.geometry.coordinates[1] }));
    } catch (error) {
      if (request.signal.aborted) throw error;
      if (mode === "search") {
        const alternative = new URL("https://data.geopf.fr/geocodage/completion");
        alternative.search = new URLSearchParams({ text: url.searchParams.get("q")!, type: "StreetAddress", maximumResponses: "5" }).toString();
        const { status, body } = await fetchJson(alternative, fetcher, 4000, request.signal);
        if (status === 429) return failure(429, "Le service d’adresses est très sollicité. Réessayez dans un instant.");
        candidates = completionCandidates(body);
      } else {
        const latitude = Number(params.get("lat")), longitude = Number(params.get("lon"));
        const { status, body } = await fetchJson(nearbyBanUrl(latitude, longitude), fetcher, 4000, request.signal);
        if (status === 429) return failure(429, "Le service d’adresses est très sollicité. Réessayez dans un instant.");
        candidates = parseNearbyBan(body, latitude, longitude);
      }
    }
    const body: AddressSuggestions = { source: "IGN / BAN", attribution: "Source : IGN Géoplateforme — Base Adresse Nationale (BAN)", candidates };
    return Response.json(body, { headers });
  } catch {
    return failure(503, "La recherche d’adresses est momentanément indisponible. Vous pouvez saisir l’adresse manuellement.");
  } finally { state.active--; }
}
