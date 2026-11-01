// FASTSPLIT-CLIENT-ADDRESS-NAME-001 — address field leaf: pure controller with fake timers,
// deferred search/reverse promises and a fake geolocation; SSR of the real component.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import Module, { createRequire } from "node:module";
import type * as AF from "../../components/app/address-field";
import type { AddressCandidate, AddressState, AddressSuggestions, AddressValue } from "../../components/app/address-field";

// Real Node globals (AbortController, Response…): load through Node itself, CSS modules stubbed.
const extensions = (Module as unknown as { _extensions: Record<string, (m: { exports: unknown }) => void> })._extensions;
extensions[".css"] ??= (m) => {
  m.exports = new Proxy({}, { get: (_t, k) => (k === "__esModule" ? false : String(k)) });
};
const mod = createRequire(import.meta.url)("../../components/app/address-field.tsx") as typeof AF;
const { createAddressController, createAddressApi, ADDRESS_COPY, DEBOUNCE_MS, GEO_TIMEOUT_MS, AddressField } = mod;

// ---- fakes -------------------------------------------------------------------------------------
function fakeTimers() {
  let now = 0;
  let next = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        queue.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (h: unknown) => void queue.delete(h as number),
      now: () => now,
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && queue.has(id)) {
          queue.delete(id);
          t.fn();
        }
      }
    },
    pending: () => queue.size,
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setImmediate(r));
const cand = (n: number, over: Partial<AddressCandidate> = {}): AddressCandidate => ({ id: `id${n}`, label: `${n} rue A 97200 Fort-de-France`, address: `${n} rue A`, postal_code: "97200", city: "Fort-de-France", latitude: 14.6 + n, longitude: -61.07, ...over });
const reply = (list: AddressCandidate[]): AddressSuggestions => ({ source: "IGN / BAN", candidates: list, attribution: "Source : IGN Géoplateforme — BAN" });

function setup(extra: Record<string, unknown> = {}) {
  const t = fakeTimers();
  const calls: { q: string; signal: AbortSignal; d: ReturnType<typeof deferred<AddressSuggestions>> }[] = [];
  const picks: AddressValue[] = [];
  const states: AddressState[] = [];
  const ctrl = createAddressController({
    search: (q, signal) => {
      const d = deferred<AddressSuggestions>();
      calls.push({ q, signal, d });
      return d.promise;
    },
    onPick: (f) => picks.push(f),
    onState: (s) => states.push(s),
    timers: t.timers,
    ...extra,
  });
  return { t, calls, picks, states, ctrl, last: () => ctrl.getState() };
}

// ---- search ------------------------------------------------------------------------------------
test("moins de 3 caractères : aucune recherche ; sinon une seule après ~300 ms (debounce)", () => {
  const { t, calls, ctrl, last } = setup();
  ctrl.input("12");
  ctrl.input("  1 ");
  t.advance(1000);
  assert.equal(calls.length, 0);
  assert.equal(last().open, false);
  ctrl.input("12 r");
  t.advance(DEBOUNCE_MS - 1);
  ctrl.input("12 ru");
  t.advance(DEBOUNCE_MS - 1);
  ctrl.input("12 rue");
  t.advance(DEBOUNCE_MS - 1);
  assert.equal(calls.length, 0);
  t.advance(1);
  assert.deepEqual(calls.map((c) => c.q), ["12 rue"]);
  assert.equal(last().status, "searching");
  assert.equal(ADDRESS_COPY.searching, "Recherche…");
});

test("annulation : la requête précédente est abandonnée et sa réponse tardive ignorée", async () => {
  const { t, calls, ctrl, last } = setup();
  ctrl.input("12 rue");
  t.advance(DEBOUNCE_MS);
  ctrl.input("12 rue des");
  assert.equal(calls[0].signal.aborted, true);
  t.advance(DEBOUNCE_MS);
  calls[1].d.resolve(reply([cand(2)]));
  await flush();
  calls[0].d.resolve(reply([cand(9)])); // tardive
  await flush();
  assert.deepEqual(last().candidates.map((c) => c.id), ["id2"]);
});

test("≤ 5 suggestions, attribution, aucune sélection automatique ; vide → « Aucune adresse trouvée »", async () => {
  const { t, calls, ctrl, last, picks } = setup();
  ctrl.input("rue A");
  t.advance(DEBOUNCE_MS);
  calls[0].d.resolve(reply([1, 2, 3, 4, 5, 6, 7].map((n) => cand(n))));
  await flush();
  assert.equal(last().candidates.length, 5);
  assert.equal(last().status, "results");
  assert.equal(last().active, -1);
  assert.match(last().attribution, /IGN/);
  assert.equal(mod.attributionText(""), "Suggestions IGN / BAN");
  assert.equal(mod.attributionText(" Source : BAN "), "Suggestions IGN / BAN — Source : BAN");
  assert.deepEqual(picks, []);
  ctrl.input("rue Z");
  t.advance(DEBOUNCE_MS);
  calls[1].d.resolve(reply([]));
  await flush();
  assert.equal(last().status, "empty");
  assert.equal(ADDRESS_COPY.empty, "Aucune adresse trouvée");
});

test("clavier : ↓/↑ bouclent, Entrée choisit, Échap ferme ; seule la rue/CP/ville est émise", async () => {
  const { t, calls, ctrl, last, picks } = setup();
  assert.equal(ctrl.choose(), false); // rien d’ouvert
  ctrl.input("rue A");
  t.advance(DEBOUNCE_MS);
  calls[0].d.resolve(reply([cand(1), cand(2), cand(3)]));
  await flush();
  ctrl.move(1);
  assert.equal(last().active, 0);
  ctrl.move(-1);
  assert.equal(last().active, 2);
  ctrl.move(1);
  assert.equal(last().active, 0);
  ctrl.close();
  assert.equal(last().open, false);
  assert.equal(ctrl.choose(0), false); // fermé : Entrée ne choisit rien
  ctrl.move(1); // ↓ rouvre
  ctrl.move(1);
  assert.equal(last().active, 1);
  assert.equal(ctrl.choose(), true);
  assert.deepEqual(picks, [{ address: "2 rue A", postal_code: "97200", city: "Fort-de-France" }]);
  assert.deepEqual(Object.keys(picks[0]).sort(), ["address", "city", "postal_code"]);
  assert.equal(last().open, false);
  assert.equal(t.pending(), 0);
});

test("saisie manuelle jamais écrasée : une réponse tardive après choix ou nouvelle frappe n’émet rien", async () => {
  const { t, calls, ctrl, last, picks } = setup();
  ctrl.input("rue A");
  t.advance(DEBOUNCE_MS);
  ctrl.input("rue Ab"); // frappe pendant la requête
  calls[0].d.resolve(reply([cand(1)]));
  await flush();
  assert.notEqual(last().status, "results"); // réponse périmée ignorée (debounce en cours)
  assert.equal(last().candidates.length, 0);
  t.advance(DEBOUNCE_MS);
  calls[1].d.resolve(reply([cand(2)]));
  await flush();
  ctrl.choose(0);
  ctrl.input("rue Abc"); // l’utilisateur reprend la main
  t.advance(DEBOUNCE_MS);
  ctrl.input("x"); // < 3 : annule
  calls[2].d.resolve(reply([cand(3)]));
  await flush();
  assert.equal(picks.length, 1); // seul le choix explicite
  assert.equal(last().open, false);
});

test("erreurs : message neutre, 400 sans blocage, 429/503 → aucune requête avant Retry-After", async () => {
  const { t, calls, ctrl, last } = setup();
  ctrl.input("rue A");
  t.advance(DEBOUNCE_MS);
  calls[0].d.reject({ message: "Saisissez une adresse entre 3 et 200 caractères.", retryable: false });
  await flush();
  assert.equal(last().status, "unavailable");
  assert.equal(last().message, "Saisissez une adresse entre 3 et 200 caractères.");
  ctrl.input("rue B");
  t.advance(DEBOUNCE_MS);
  assert.equal(calls.length, 2); // 400 : pas de blocage
  calls[1].d.reject({ message: "Le service d’adresses est très sollicité.", retryable: true, retryAfterSeconds: 2 });
  await flush();
  for (const q of ["rue C", "rue Cd", "rue Cde"]) {
    ctrl.input(q);
    t.advance(DEBOUNCE_MS);
  }
  assert.equal(calls.length, 2); // pas de tempête pendant Retry-After
  assert.equal(last().status, "unavailable");
  t.advance(2000);
  ctrl.input("rue D");
  t.advance(DEBOUNCE_MS);
  assert.equal(calls.length, 3);
  // erreur sans message → texte par défaut
  calls[2].d.reject(new Error(""));
  await flush();
  assert.equal(last().message, ADDRESS_COPY.unavailable);
  assert.equal(ADDRESS_COPY.unavailable, "Suggestions indisponibles, saisissez l’adresse");
});

// ---- geolocation -------------------------------------------------------------------------------
function fakeGeo() {
  const requests: { ok: (p: GeolocationPosition) => void; ko: (e: { code: number }) => void; options?: PositionOptions }[] = [];
  return {
    requests,
    geo: {
      getCurrentPosition: (ok: PositionCallback, ko?: PositionErrorCallback | null, options?: PositionOptions) => {
        requests.push({ ok: ok as never, ko: ko as never, options });
      },
    },
  };
}
const position = (lat: number, lon: number) => ({ coords: { latitude: lat, longitude: lon } }) as GeolocationPosition;

test("position : uniquement au clic, une seule demande, délai ~10 s, confirmation avant remplissage", async () => {
  const g = fakeGeo();
  const rev: { lat: number; lon: number; d: ReturnType<typeof deferred<AddressSuggestions>> }[] = [];
  const { ctrl, last, picks } = setup({ geolocation: g.geo, reverse: (lat: number, lon: number) => { const d = deferred<AddressSuggestions>(); rev.push({ lat, lon, d }); return d.promise; } });
  assert.equal(g.requests.length, 0); // rien sans clic
  ctrl.locate();
  ctrl.locate(); // double clic : une seule demande
  assert.equal(g.requests.length, 1);
  assert.equal(g.requests[0].options?.timeout, GEO_TIMEOUT_MS);
  assert.equal(last().geo, "locating");
  g.requests[0].ok(position(14.61, -61.05));
  assert.deepEqual(rev.map((r) => [r.lat, r.lon]), [[14.61, -61.05]]);
  rev[0].d.resolve(reply([cand(4)]));
  await flush();
  assert.equal(last().geo, "confirm");
  assert.deepEqual(picks, []); // pas de remplissage avant confirmation
  ctrl.confirmGeo(true);
  assert.deepEqual(picks, [{ address: "4 rue A", postal_code: "97200", city: "Fort-de-France" }]);
  assert.ok(!JSON.stringify(picks).includes("14.6") && !JSON.stringify(picks).includes("-61")); // aucune coordonnée émise
  assert.equal(last().geo, "idle");
});

test("position : « Non » ne remplit rien ; refus, délai, aucune adresse, erreur → message + saisie manuelle", async () => {
  const cases: [string, (r: ReturnType<typeof fakeGeo>["requests"][number], rev: ReturnType<typeof deferred<AddressSuggestions>>[], t: ReturnType<typeof fakeTimers>) => Promise<void> | void, string][] = [
    ["non", async (r, rev) => { r.ok(position(1, 2)); rev[0].resolve(reply([cand(1)])); await flush(); }, "confirm-no"],
    ["refus", (r) => r.ko({ code: 1 }), ADDRESS_COPY.geoRefused],
    ["délai navigateur", (r) => r.ko({ code: 3 }), ADDRESS_COPY.geoTimeout],
    ["aucun rappel", (_r, _rev, t) => t.advance(GEO_TIMEOUT_MS + 500), ADDRESS_COPY.geoTimeout],
    ["aucune adresse", async (r, rev) => { r.ok(position(1, 2)); rev[0].resolve(reply([])); await flush(); }, ADDRESS_COPY.geoNone],
    ["erreur", async (r, rev) => { r.ok(position(1, 2)); rev[0].reject({ message: "La recherche d’adresses est momentanément indisponible.", retryable: true }); await flush(); }, "La recherche d’adresses est momentanément indisponible."],
  ];
  for (const [name, act, expected] of cases) {
    const g = fakeGeo();
    const rev: ReturnType<typeof deferred<AddressSuggestions>>[] = [];
    const s = setup({ geolocation: g.geo, reverse: () => { const d = deferred<AddressSuggestions>(); rev.push(d); return d.promise; } });
    s.ctrl.locate();
    await act(g.requests[0], rev, s.t);
    if (expected === "confirm-no") {
      s.ctrl.confirmGeo(false);
      assert.equal(s.last().geo, "idle", name);
    } else {
      assert.equal(s.last().geo, "message", name);
      assert.equal(s.last().geoMessage, expected, name);
    }
    assert.deepEqual(s.picks, [], name);
    assert.equal(g.requests.length, 1, name); // jamais de nouvelle demande implicite
  }
});

test("sans géolocalisation ni reverse : locate() ne fait rien", () => {
  const s = setup({ geolocation: null });
  s.ctrl.locate();
  assert.equal(s.last().geo, "idle");
});

// ---- API client ----------------------------------------------------------------------------
test("client API : enveloppe filtrée (≤ 5), erreurs { message, retryable } + Retry-After", async () => {
  const urls: string[] = [];
  const ok = createAddressApi({
    fetcher: (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(reply([1, 2, 3, 4, 5, 6].map((n) => cand(n)))), { status: 200 });
    }) as never,
  });
  const r = await ok.search("12 rue des É", new AbortController().signal);
  assert.equal(r.candidates.length, 5);
  await ok.reverse(14.6, -61.07, new AbortController().signal);
  assert.deepEqual(urls, ["/api/addresses/search?q=12%20rue%20des%20%C3%89", "/api/addresses/reverse?lat=14.6&lon=-61.07"]);
  const busy = createAddressApi({ fetcher: (async () => new Response(JSON.stringify({ message: "Très sollicité.", retryable: true }), { status: 429, headers: { "Retry-After": "2" } })) as never });
  await assert.rejects(busy.search("rue A", new AbortController().signal), (e: unknown) => {
    assert.equal(JSON.stringify(e), JSON.stringify({ message: "Très sollicité.", retryable: true, retryAfterSeconds: 2 }));
    return true;
  });
  const bad = createAddressApi({ fetcher: (async () => new Response("{}", { status: 400 })) as never });
  await assert.rejects(bad.search("ab", new AbortController().signal), (e: unknown) => (e as { retryable: boolean }).retryable === false);
});

// ---- SSR -----------------------------------------------------------------------------------
test("SSR sans window : 3 champs étiquetés et éditables, combobox ARIA, bouton position seulement si possible", () => {
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  const value = { address: "12 rue des Écoles", postal_code: "97200", city: "Fort-de-France" };
  const html = renderToString(createElement(AddressField as never, { value, onChange() {}, search: async () => reply([]), reverse: async () => reply([]), geolocation: { getCurrentPosition() {} }, error: "Adresse requise." } as never)).replaceAll("<!-- -->", "");
  for (const label of ["Adresse d’intervention", "Code postal", "Ville"]) assert.match(html, new RegExp(`<label for="[^"]+">${label}</label>`));
  assert.match(html, /role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /value="12 rue des Écoles"/);
  assert.match(html, /autoComplete="postal-code"[^>]*value="97200"|value="97200"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /role="alert"[^>]*>Adresse requise\./);
  assert.match(html, />Utiliser ma position</);
  assert.doesNotMatch(html, /latitude|longitude|14\.6/);
  const noGeo = renderToString(createElement(AddressField as never, { value, onChange() {}, geolocation: null } as never));
  assert.doesNotMatch(noGeo, /Utiliser ma position/);
  assert.match(noGeo, /required=""/);
});

// ---- Remplacement externe de la valeur (nouveau brouillon / réinitialisation) -----------------
test("valeur remplacée par le parent : seule une valeur non émise par le champ est « externe »", () => {
  const v = { address: "1 rue A", postal_code: "97200", city: "Fort-de-France" };
  assert.equal(mod.isExternalChange(v, { ...v }), false);
  assert.equal(mod.isExternalChange({ ...v, address: "" }, v), true);
  assert.equal(mod.isExternalChange({ ...v, city: "Lamentin" }, v), true);
});

test("reset() : recherche annulée, liste vidée, géolocalisation en attente ignorée, confirmation abandonnée", async () => {
  const g = fakeGeo();
  const rev: ReturnType<typeof deferred<AddressSuggestions>>[] = [];
  const s = setup({ geolocation: g.geo, reverse: () => { const d = deferred<AddressSuggestions>(); rev.push(d); return d.promise; } });
  // 1. recherche en vol + liste ouverte → reset
  s.ctrl.input("rue A");
  s.t.advance(DEBOUNCE_MS);
  s.calls[0].d.resolve(reply([cand(1)]));
  await flush();
  s.ctrl.input("rue Ab");
  s.t.advance(DEBOUNCE_MS);
  assert.equal(s.calls.length, 2);
  s.ctrl.reset();
  assert.equal(s.calls[1].signal.aborted, true);
  assert.equal(JSON.stringify(s.last()), JSON.stringify(mod.INITIAL_ADDRESS_STATE));
  s.calls[1].d.resolve(reply([cand(2)])); // réponse tardive : ignorée
  await flush();
  assert.equal(s.last().open, false);
  assert.equal(s.ctrl.choose(0), false);
  // 2. confirmation en attente → reset → « Utiliser cette adresse » ne peut plus s’appliquer
  s.ctrl.locate();
  g.requests[0].ok(position(14.6, -61));
  rev[0].resolve(reply([cand(4)]));
  await flush();
  assert.equal(s.last().geo, "confirm");
  s.ctrl.reset();
  s.ctrl.confirmGeo(true);
  assert.equal(s.last().geo, "idle");
  // 3. géolocalisation pendante (rappel et reverse tardifs) → reset → ignorée
  s.ctrl.locate();
  assert.equal(g.requests.length, 2);
  s.ctrl.reset();
  g.requests[1].ok(position(14.6, -61)); // rappel tardif après reset
  assert.equal(rev.length, 1); // aucun reverse lancé
  s.ctrl.locate();
  g.requests[2].ok(position(14.6, -61));
  s.ctrl.reset(); // reverse en vol
  rev[1].resolve(reply([cand(5)]));
  await flush();
  assert.equal(s.last().geo, "idle");
  assert.equal(s.t.pending(), 0); // garde de délai annulée
  assert.deepEqual(s.picks, []); // rien n’a été appliqué au nouveau brouillon
});
