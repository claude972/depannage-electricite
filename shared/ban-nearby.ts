import { z } from "zod";
import type { BookingAddressCandidate } from "./booking-address";

const text = z.string().trim().min(1).max(300);
const geometry = z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]) });
const postal = z.string().regex(/^\d{5}$/);

// The IGN also publishes the same BAN points through WFS. Limit the spatial query to
// the pin's neighbourhood and rank locally because WFS does not sort by distance.
const WFS_LIMIT = 100;
const MAX_ADDRESS_DISTANCE_METRES = 100;
const wfsFeature = z.object({ geometry, properties: z.object({
  id: text,
  numero: z.string().regex(/^\d{1,6}$/),
  rep: z.string().max(12).nullable().optional(),
  nom_voie: text,
  code_postal: postal,
  nom_commune: text,
}) });
const wfsCollection = z.object({ type: z.literal("FeatureCollection"), features: z.array(z.unknown()).max(WFS_LIMIT) });

export function nearbyBanUrl(latitude: number, longitude: number): URL {
  const longitudeScale = Math.max(0.01, Math.cos(latitude * Math.PI / 180));
  const degrees = MAX_ADDRESS_DISTANCE_METRES / 111_200;
  const west = Math.max(-180, longitude - degrees / longitudeScale);
  const east = Math.min(180, longitude + degrees / longitudeScale);
  const south = Math.max(-90, latitude - degrees);
  const north = Math.min(90, latitude + degrees);
  const url = new URL("https://data.geopf.fr/wfs");
  url.search = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: "BAN.DATA.GOUV:ban", count: String(WFS_LIMIT),
    outputFormat: "application/json", srsName: "EPSG:4326", propertyName: "geom,id,numero,rep,nom_voie,code_postal,nom_commune",
    // WFS 2.0 EPSG:4326 bounding boxes use latitude then longitude.
    bbox: `${south},${west},${north},${east},urn:ogc:def:crs:EPSG::4326`,
  }).toString();
  return url;
}

export function parseNearbyBan(body: unknown, latitude: number, longitude: number): BookingAddressCandidate[] {
  const longitudeScale = Math.max(0.01, Math.cos(latitude * Math.PI / 180));
  const { features } = wfsCollection.parse(body);
  const valid = features.map(feature => wfsFeature.safeParse(feature)).flatMap(parsed => parsed.success ? [parsed.data] : []);
  if (features.length && !valid.length) throw Error("invalid BAN features");
  const results = valid.flatMap(feature => {
    const [lon, lat] = feature.geometry.coordinates;
    const metres = 111_200 * Math.hypot(lat - latitude, (lon - longitude) * longitudeScale);
    if (metres > MAX_ADDRESS_DISTANCE_METRES) return [];
    const p = feature.properties;
    const address = [Number(p.numero) ? p.numero : "", p.rep?.trim(), p.nom_voie].filter(Boolean).join(" ");
    const candidate: BookingAddressCandidate = { id: p.id, address, postal_code: p.code_postal, city: p.nom_commune, label: `${address}, ${p.code_postal} ${p.nom_commune}`, latitude: lat, longitude: lon };
    return [{ metres, candidate }];
  });
  const seen = new Set<string>();
  return results.sort((a, b) => a.metres - b.metres).flatMap(({ candidate }) => {
    if (seen.has(candidate.id)) return [];
    seen.add(candidate.id);
    return [candidate];
  }).slice(0, 5);
}
