// Shared helpers of the ADV-DOCUMENTS-001 tests: an in-process TypeScript module loader (like the
// other route tests, with recursive relative/@ imports), fake Supabase helpers and sample snapshots.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";

const nodeRequire = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fakeServerHelpers(options: { authenticated?: boolean; db: unknown }) {
  return {
    ApiError,
    authenticatedClient: async () => {
      if (options.authenticated === false) throw new ApiError(401, "Session requise");
      return { user: { id: "10000000-0000-4000-8000-000000000009" }, db: options.db };
    },
    assertOrigin: (request: Request) => {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Origine refusée");
    },
    dbError: (error: { code?: string } | null) => {
      if (!error) return;
      const map: Record<string, number> = { P0001: 409, "23505": 409, "42501": 403, P0002: 404, "22023": 422, "53300": 429 };
      throw new ApiError(map[error.code ?? ""] ?? 503, "Commande refusée");
    },
    apiError: (error: unknown) =>
      Response.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 500 }),
  };
}

type Exports = Record<string, unknown>;
/** Compiles `relativeFromRoot` and everything it imports relatively or through `@/`; `overrides`
 *  win for exact specifiers (e.g. "@/lib/supabase/server", "*.module.css"). */
export function loadModule(relativeFromRoot: string, overrides: Record<string, unknown> = {}, env?: Record<string, string | undefined>): Exports {
  const cache = new Map<string, Exports>();
  // An override given as "@/lib/x" also applies when a module reaches that file through a relative
  // import (e.g. validation.ts importing "./server"), so one fake ApiError class is shared.
  const overrideByPath = new Map<string, unknown>();
  for (const [key, value] of Object.entries(overrides)) if (key.startsWith("@/")) for (const ext of [".ts", ".tsx"]) overrideByPath.set(path.join(ROOT, key.slice(2)) + ext, value);
  const cssModule = (): unknown => {
    const proxy: unknown = new Proxy({}, { get: (_t, key) => (key === "__esModule" ? undefined : key === "default" ? proxy : String(key)) });
    return proxy;
  };
  const resolve = (from: string, name: string): string | null => {
    let base: string;
    if (name.startsWith("@/")) base = path.join(ROOT, name.slice(2));
    else if (name.startsWith(".")) base = path.resolve(path.dirname(from), name);
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        if (readFileSync(candidate).length >= 0 && /\.(ts|tsx|css)$/.test(candidate)) return candidate;
      } catch {
        /* directory */
      }
    }
    return null;
  };
  const compile = (file: string): Exports => {
    const cached = cache.get(file);
    if (cached) return cached;
    const module: { exports: Exports } = { exports: {} };
    cache.set(file, module.exports);
    const source = readFileSync(file, "utf8");
    const code = transformSync(source, { loader: file.endsWith(".tsx") ? "tsx" : "ts", format: "cjs", target: "es2022", jsx: "automatic" }).code;
    const localRequire = (name: string) => {
      if (name in overrides) return overrides[name];
      if (name.endsWith(".css")) return cssModule();
      const resolved = resolve(file, name);
      if (resolved && overrideByPath.has(resolved)) return overrideByPath.get(resolved);
      if (resolved) return compile(resolved);
      return nodeRequire(name);
    };
    vm.runInNewContext(code, { ...(env && { process: { env } }), module, exports: module.exports, require: localRequire, URL, Request, Response, ReadableStream, TextEncoder, Buffer, SyntaxError, console, Date, Math, Number, JSON, Promise, Array, Object, String, Error, TypeError, Symbol, Map, Set, Proxy, Reflect, RegExp, ArrayBuffer, Uint8Array, Intl, setTimeout, clearTimeout, queueMicrotask }, { filename: file });
    cache.set(file, module.exports);
    return module.exports;
  };
  return compile(path.join(ROOT, relativeFromRoot));
}

export const IDS = {
  intervention: "20000000-0000-4000-8000-000000000001",
  quote: "10000000-0000-4000-8000-000000000001",
  amendment: "30000000-0000-4000-8000-000000000001",
  document: "40000000-0000-4000-8000-000000000001",
};

/** Realistic snapshot such as migration 015 stores it (30 lines by default → two pages). */
export function sampleSnapshot(overrides: { kind?: "quote" | "amendment"; lineCount?: number; amendment?: Record<string, unknown> | null; quote?: Record<string, unknown> } = {}) {
  const lineCount = overrides.lineCount ?? 30;
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    label: i === 3 ? "Remplacement d’un disjoncteur différentiel 30 mA type A avec reprise complète du câblage existant (parenthèses) et \\ antislash" : `Ligne ${i + 1} — main-d’œuvre`,
    quantity: (i % 3) + 1,
    unit_price_cents: 6000 + i * 100,
  }));
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price_cents, 0);
  const tax = Math.round((subtotal * 20) / 100);
  const quote = {
    id: IDS.quote,
    reference: "DEV-100000",
    status: "accepted",
    created_at: "2026-10-31T12:00:00+00:00",
    accepted_at: "2026-10-31T13:30:00+00:00",
    lines,
    subtotal_cents: subtotal,
    tax_rate: 20,
    tax_cents: tax,
    total_cents: subtotal + tax,
    terms: { valid_until: "2026-11-15", validity: "valid" },
    ...(overrides.quote ?? {}),
  };
  const amendment =
    overrides.kind === "amendment"
      ? {
          id: IDS.amendment,
          version: 3,
          reference: "AV-3-DEV-100000",
          status: "accepted",
          reason: "Reprise du tableau : deux départs supplémentaires nécessaires.",
          created_at: "2026-11-02T09:00:00Z",
          decided_at: "2026-11-02T10:00:00Z",
          decision_note: "OK pour les deux départs",
          terms: { valid_until: null, validity: "unspecified" },
          lines: [{ label: "Disjoncteur supplémentaire", quantity: 2, unit_price_cents: 6000 }],
          subtotal_cents: 12000,
          tax_rate: 20,
          tax_cents: 2400,
          total_cents: 14400,
          cumulative_total_cents: subtotal + tax + 14400 + 5000,
          ...(overrides.amendment ?? {}),
        }
      : (overrides.amendment ?? null);
  return {
    kind: overrides.kind ?? "quote",
    reference: overrides.kind === "amendment" ? "AV-3-DEV-100000" : "DEV-100000",
    currency: "EUR",
    intervention: { id: IDS.intervention, reference: "INT-200000", category: "panel", urgency: "urgent", address: "12 rue du Test", postal_code: "97200", city: "Fort-de-France", description: "Le tableau présente des déclenchements répétés du différentiel général depuis trois jours." },
    issuer: { company_name: "Entreprise QA Électricité", legal_status: "EI", siret: "12345678901234", address: "12 rue du Test, 97200 Fort-de-France", contact_name: "Jean QA", phone: "0696000000", missing_optional: ["vat_number", "insurance"] },
    recipient: { name: "Client Démo", organization: { name: "Syndic Démo" }, site: { name: "Résidence Les Alizés", address: "3 allée des Flamboyants, 97200 Fort-de-France" } },
    quote,
    amendment,
    settlement: "not_connected",
    notices: ["Ce document n’est pas une facture.", "Montants en euros, TVA au taux indiqué, calculés par la plateforme à partir des lignes."],
  };
}
export const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
