import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Recette PWA du 15/11 : avec un cookie de session révoqué, /api/public/indicative-prices et
// /api/public/operator-profile répondaient 403 (PGRST301) et l'accueil public perdait ses données.
// Les lectures publiques passent par un client anonyme qui ne lit jamais les cookies.
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

test("public read routes never forward the visitor's session cookies", () => {
  const routes = readdirSync(path.join(ROOT, "app/api/public")).map(dir => `app/api/public/${dir}/route.ts`);
  const sources = [...routes, "lib/features/indicative-prices/handler.ts"];
  for (const file of sources) {
    const source = read(file);
    if (!/rpc\(\s*["']read_(public_|indicative_prices)/.test(source)) continue;
    const publicHandler = file.endsWith("handler.ts") ? /export async function publicGET[^]*?\}\}/.exec(source)?.[0] ?? "" : source;
    assert.match(publicHandler, /publicClient\(\)/, `${file} doit lire via publicClient()`);
    assert.doesNotMatch(publicHandler, /serverClient\(\)/, `${file} ne doit pas transmettre les cookies de session`);
  }
});

test("publicClient is anonymous: no cookie store, no persisted or refreshed session", () => {
  const server = read("lib/supabase/server.ts");
  const body = /export function publicClient\(\) \{[^]*?\n\}/.exec(server)?.[0] ?? "";
  assert.ok(body, "publicClient manquant");
  assert.doesNotMatch(body, /cookies|createServerClient|Authorization/);
  assert.match(body, /persistSession: false, autoRefreshToken: false/);
});
