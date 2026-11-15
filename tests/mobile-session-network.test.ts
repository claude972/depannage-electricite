import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import vm from "node:vm";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

// Preuves CODE + tests ciblés (pas une recette native) : client API mobile et contrat de session
// pour tous les profils — connexion, déconnexion, restauration, erreurs réseau. La recette native
// connectée reste à jouer sur appareil (voir FINALISATION_STATUS.md).
const ORIGIN = "https://candidate.example";
type Api = <T>(path: string, schema: z.ZodType<T>, options?: { token?: string; method?: "GET" | "POST" | "PATCH"; body?: object; signal?: AbortSignal }) => Promise<T>;
type Failure = Error & { status: number; code?: string };

function mobileApi(fetchImpl: typeof fetch, origin: string | undefined = ORIGIN) {
  const code = transformSync(readFileSync("apps/mobile/src/lib/api.ts", "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
  const fakes: Record<string, unknown> = {
    "./config": { apiOrigin: origin },
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    react: { useCallback: (f: unknown) => f, useEffect: () => {}, useState: (v: unknown) => [v, () => {}] },
  };
  const nodeRequire = createRequire(import.meta.url);
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(code, { module, exports: module.exports, require: (n: string) => (n in fakes ? fakes[n] : nodeRequire(n)), fetch: fetchImpl, URL, Response, AbortController, DOMException, FormData, setTimeout, clearTimeout, Promise, Error, TypeError, JSON, Object, Array, String }, { filename: "api.ts" });
  return { api: module.exports.api as Api, restore: () => {} };
}
const schema = z.object({ ok: z.literal(true) });
const failure = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Failure; } assert.fail("une erreur était attendue"); };

test("bearer only to the configured API origin, never cookies or redirects", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const m = mobileApi((async (url: URL, init: RequestInit) => { seen.push({ url: String(url), init }); return new Response('{"ok":true}', { status: 200 }); }) as unknown as typeof fetch);
  try {
    assert.deepEqual(await m.api("/api/workspace", schema, { token: "a.b.c" }), { ok: true });
    assert.equal(seen[0].url, `${ORIGIN}/api/workspace`);
    assert.equal((seen[0].init.headers as Record<string, string>).Authorization, "Bearer a.b.c");
    assert.equal(seen[0].init.credentials, "omit");
    assert.equal(seen[0].init.redirect, "error");
    for (const path of ["https://evil.example/api/x", "/auth/v1/user", "//evil.example/api/x"])
      assert.equal((await failure(m.api(path, schema, { token: "a.b.c" }))).status, 0, path);
    assert.equal(seen.length, 1, "aucune requête hors de /api/ de l'origine configurée");
  } finally { m.restore(); }
});

test("guest (no token) sends no Authorization header", async () => {
  let headers: Record<string, string> = {};
  const m = mobileApi((async (_u: URL, init: RequestInit) => { headers = init.headers as Record<string, string>; return new Response('{"ok":true}'); }) as unknown as typeof fetch);
  try { await m.api("/api/public/services", schema); assert.equal(headers.Authorization, undefined); } finally { m.restore(); }
});

test("network loss, timeout abort and malformed answers become explicit, retryable messages", async () => {
  const offline = mobileApi((async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch);
  try {
    const e = await failure(offline.api("/api/workspace", schema, { token: "a.b.c" }));
    assert.equal(e.status, 0);
    assert.match(e.message, /Connexion interrompue/);
  } finally { offline.restore(); }
  const aborted = new AbortController(); aborted.abort();
  const hang = mobileApi(((_u: URL, init: RequestInit) => new Promise((_r, reject) => { if (init.signal?.aborted) reject(new DOMException("aborted", "AbortError")); init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); })) as unknown as typeof fetch);
  try { assert.equal((await failure(hang.api("/api/workspace", schema, { signal: aborted.signal }))).status, 0); } finally { hang.restore(); }
  const bad = mobileApi((async () => new Response('{"ok":"partial"}', { status: 200 })) as unknown as typeof fetch);
  try { const e = await failure(bad.api("/api/workspace", schema)); assert.equal(e.status, 502); assert.match(e.message, /incomplète/); } finally { bad.restore(); }
  assert.match(readFileSync("apps/mobile/src/lib/api.ts", "utf8"), /setTimeout\(abort, 20000\)/, "délai réseau borné à 20 s");
});

test("expired or revoked session: the server reason is shown, status kept for the screen", async () => {
  for (const [status, body] of [[401, { error: "Connectez-vous pour accéder à cet espace." }], [403, { error: "Vous n’avez pas accès à cette action.", code: "forbidden" }], [503, null]] as const) {
    const m = mobileApi((async () => new Response(body === null ? "oops" : JSON.stringify(body), { status })) as unknown as typeof fetch);
    try {
      const e = await failure(m.api("/api/workspace", schema, { token: "a.b.c" }));
      assert.equal(e.status, status);
      assert.equal(e.message, body?.error ?? "Le service est momentanément indisponible.");
      if (body && "code" in body) assert.equal(e.code, body.code);
    } finally { m.restore(); }
  }
});

test("session contract: restore, sign-in per role, sign-out and account switch never leak data", () => {
  const session = readFileSync("apps/mobile/src/lib/session.tsx", "utf8");
  const api = readFileSync("apps/mobile/src/lib/api.ts", "utf8");
  const layout = readFileSync("apps/mobile/src/app/_layout.tsx", "utf8");
  const entry = readFileSync("apps/mobile/src/app/index.tsx", "utf8");
  // Restauration : stockage sécurisé, session persistée, rafraîchissement automatique piloté par l'état de l'app.
  assert.match(session, /storage: secureStorage, autoRefreshToken: true, persistSession: true/);
  assert.match(session, /'La session n’a pas pu être restaurée\. Reconnectez-vous\.'/);
  assert.match(session, /'Le stockage sécurisé est indisponible\.'/);
  assert.match(session, /if \(state === 'active'\) void client\.startAutoRefresh\(\);\s*else void client\.stopAutoRefresh\(\);/);
  // Un événement d'authentification (connexion, rafraîchissement refusé, déconnexion) prime sur la lecture initiale.
  assert.match(session, /if \(!live \|\| changed\) return;/);
  // Déconnexion : session locale effacée, reprises en attente oubliées.
  assert.match(session, /auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(session, /if \(!value\) \{\s*setPhoneResume\(null\);\s*setLoginResume\(null\);/);
  // Pile remontée par compte : aucun écran d'un compte ne survit au changement d'utilisateur.
  assert.match(layout, /<Stack key=\{session\?\.user\.id\?\?'guest'\}/);
  // Données : une lecture d'un autre compte n'est jamais affichée, même pendant un rafraîchissement.
  assert.match(api, /read\.actor === refreshActor/);
  // Retour au premier plan : relecture.
  assert.match(api, /if \(state === 'active'\) reload\(\);/);
  // Destination après connexion : profil / interventions / reprise de réservation, sinon accueil de l'espace.
  assert.match(entry, /loginResume === 'interventions'\) return <Redirect href="\/\(espace\)\/interventions" \/>/);
  assert.match(entry, /<Redirect href=\{session \? '\/\(espace\)\/accueil' : '\/bienvenue'\} \/>/);
});
