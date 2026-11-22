// ADM-06 — « Avis & Notes » embeds the existing moderation leaf (PlatformPage → PlatformModerationView,
// contract platform-operations/reviews) ONLY when the /me reply grants reviews_moderation (or super
// admin); otherwise an honest note + a link to the « Modération » view, never data or a fake success.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Admin from "../../components/role/admin-space";

const a = loadModule("components/role/admin-space.tsx") as unknown as typeof Admin;
const calls: string[] = [];
const platformClient = new Proxy({}, { get: (_t, key) => async () => { calls.push(String(key)); return new Promise(() => {}); } });
const session = (platformAccess: unknown, state = "available") =>
  ({
    profileId: "admin-1",
    role: "admin",
    mode: "live",
    platformAccess,
    capabilities: { platformOperations: state },
    features: { platform: platformClient },
    reprobeFeature: async () => {},
    openIntervention() {},
  }) as never;
const render = (s: unknown) => renderToString(createElement(a.ReviewsModeration as never, { session: s, onOpenModeration() {} } as never)).replace(/<!-- -->/g, "");

test("mode : même porte que l’entrée « Modération » (réponse /me uniquement, fail-closed)", () => {
  assert.equal(a.reviewsModerationMode(null as never), "unverified");
  assert.equal(a.reviewsModerationMode(undefined as never), "unverified");
  assert.equal(a.reviewsModerationMode({ super_admin: false, capabilities: { finance: true } } as never), "not_allowed");
  assert.equal(a.reviewsModerationMode({ super_admin: false, capabilities: { reviews_moderation: false } } as never), "not_allowed");
  assert.equal(a.reviewsModerationMode({ super_admin: false, capabilities: { reviews_moderation: true } } as never), "embedded");
  assert.equal(a.reviewsModerationMode({ super_admin: true } as never), "embedded");
});

test("droit de modération ⇒ vue de modération existante intégrée, plus de « Pas encore activé »", () => {
  const html = render(session({ super_admin: false, capabilities: { reviews_moderation: true } }));
  assert.match(html, /data-reviews-moderation="embedded"/);
  assert.match(html, /<h2 id="admin-reviews-moderation">Modération des avis<\/h2>/);
  // PlatformModerationView itself renders (its own loading state first: it re-reads /me rights).
  assert.match(html, /<div class="page-loader" role="status"><span class="spinner"><\/span>Chargement des droits…<\/div>/);
  const src = readFileSync("components/features/platform-operations/platform-moderation-view.tsx", "utf8");
  assert.match(src, /if \(me\.loading && !me\.data\) return <Loading label="Chargement des droits…" \/>;/, "that loading state is the moderation view's");
  assert.doesNotMatch(html, /Pas encore activé|data-reviews-moderation-link/);
});

test("sans droit / droits non vérifiés ⇒ note honnête + lien « Modération », aucune donnée chargée", () => {
  calls.length = 0;
  const denied = render(session({ super_admin: false, capabilities: { finance: true } }));
  assert.match(denied, new RegExp(a.REVIEWS_MODERATION_NOT_ALLOWED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(denied, /data-blocker="ADM-06:not_allowed"/);
  assert.match(denied, /data-reviews-moderation-link=""[^>]*>Ouvrir la vue « Modération »<\/button>/);
  const unverified = render(session(null, "unknown"));
  assert.match(unverified, /data-blocker="ADM-06:unverified"/);
  assert.match(unverified, /n’ont pas encore été vérifiés par la plateforme/);
  for (const html of [denied, unverified]) {
    assert.doesNotMatch(html, /data-reviews-moderation="embedded"|Chargement des droits/);
    assert.doesNotMatch(html, /Pas encore activé sur ce service/);
  }
  assert.deepEqual(calls, [], "no platform call without the right");
});

test("« Avis & Notes » branche ReviewsModeration et le lien ouvre la vue « platform-moderation »", () => {
  const src = readFileSync("components/role/admin-space.tsx", "utf8");
  const reviews = src.slice(src.indexOf("const renderReviews = () => {"), src.indexOf("const renderMessages = () => {"));
  assert.match(reviews, /<ReviewsModeration session=\{session\} onOpenModeration=\{\(\) => go\("platform-moderation"\)\} \/>/);
  assert.doesNotMatch(reviews, /blocker="ADM-06"/);
  assert.match(src, /if \(platformViewAllowed\(access, "platform-moderation"\)\) return "embedded";/);
});
