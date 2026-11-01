// Reset password page theme (FASTSPLIT-AUTH-RESET-THEME-001): ThemeSurface + ThemeToggle, tokens
// only (no legacy blue / #f5f7fb), 44 px targets, visible focus; Auth calls and states unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadModule } from "../documents/harness";

const tp = loadModule("components/app/theme-provider.tsx");
const page = loadModule("app/auth/reset-password/page.tsx", {
  "@/components/app/theme-provider": tp,
  "@/lib/supabase/client": { createClient: () => { throw new Error("no network in SSR test"); } },
}) as Record<string, any>;

test("SSR: themed surface, theme toggle, home link, loading status (link check in progress)", () => {
  const html = renderToString(createElement(tp.ThemeProvider as never, null, createElement(page.default))).replaceAll("<!-- -->", "");
  assert.match(html, /class="[^"]*ui-v2/);
  assert.match(html, /aria-label="Courant, retour à l’accueil"/);
  assert.match(html, /role="status"[^>]*>Vérification de votre lien…/);
  assert.match(html, /<h1 id="reset-title">Choisir un nouveau mot de passe<\/h1>/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-theme-toggle=/, "theme toggle rendered (SSR placeholder until mounted)");
});

test("CSS: tokens only, no legacy blue or #f5f7fb, 44 px targets, visible focus, mobile layout", () => {
  const css = readFileSync("app/auth/reset-password/page.module.css", "utf8");
  assert.doesNotMatch(css, /#1457d9|#f5f7fb|#102a43|#172b4d|#526178|#a8b4c5|#d8e0eb/i);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b/i, "no hard-coded colour at all");
  assert.match(css, /min-height: 44px/);
  assert.match(css, /min-height: 48px/);
  assert.match(css, /outline: 3px solid var\(--ui-focus\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test("logic unchanged vs 99f92f2: same Auth calls, validation and messages", () => {
  const now = readFileSync("app/auth/reset-password/page.tsx", "utf8");
  const before = execFileSync("git", ["show", "99f92f2:app/auth/reset-password/page.tsx"], { encoding: "utf8" });
  for (const needle of ["exchangeCodeForSession(code)", "auth.getUser()", "auth.updateUser({ password })", "window.history.replaceState({}, \"\", url.pathname)", "password.length < 10 || password.length > 128", "Les deux mots de passe doivent être identiques.", "Ce lien est expiré ou a déjà été utilisé.", "Le mot de passe n’a pas pu être modifié."])
    assert.equal(now.split(needle).length, before.split(needle).length, needle);
  const logic = (src: string) => src.slice(src.indexOf("export default function"), src.indexOf("  return ("));
  assert.equal(logic(now), logic(before), "everything before the JSX is byte-identical");
});
