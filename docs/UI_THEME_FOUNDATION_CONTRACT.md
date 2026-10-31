# UI-THEME-FOUNDATION-001 — claim and short contract (lead, before code)

Owner: Claude lead (single owner of layout / globals / shared primitives). Base: integration `58b76414f6233220f938dbc42681c089abe58316`. Branch: `claude/ui-theme-foundation`. Sources: `DESIGN.md`, `docs/DIRECTION_UI_UX_VALIDEE.md`, `docs/UI_ADOPTION_IMPLEMENTATION_PLAN.md`, prototype reference `6bc0cab` (`prototypes/delivo-test/web-network.html`).

## Exact files (declared before code; nothing else is touched)

- EDIT `app/layout.tsx` — local font, anti-flash script, provider; `suppressHydrationWarning` on `<html>` ONLY (the script sets one attribute before hydration).
- EDIT `app/globals.css` — ADDITION of namespaced tokens and the opt-in wrapper only. Historical variables (`--navy`, `--blue`, `--text`, `--bg`, `--surface`…) are NOT remapped.
- NEW `components/app/theme.ts` — pure logic (no React).
- NEW `components/app/theme-provider.tsx` — `ThemeProvider`, `useUiTheme`, `ThemeSurface` (opt-in wrapper).
- NEW `components/app/theme-toggle.tsx` + `components/app/theme-toggle.module.css` — accessible toggle.
- NEW `app/fonts/plus-jakarta-sans-{400,500,600,700}.ttf`, `app/fonts/OFL.txt`, `app/fonts/PROVENANCE.md`.
- NEW `tests/ui/theme.test.ts` (pure controller, inline script in a VM, SSR with `react-dom/server`, and a real React StrictMode test in local Chromium — skipped, never passed, when Chromium is absent).
- NEW this contract.
Not touched: `components/courant-app.tsx`, session, api, backend, SQL, role modules, previews, app 28b.

## Font licence and provenance (verified by the agent)

- Files: the four Plus Jakarta Sans TTF used by the approved prototype (`prototypes/delivo-test/assets/fonts/`), copied byte-identical.
- Embedded `name` table (read directly): copyright « Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans) », version « 2.071; gftools[0.9.30] » (Google Fonts build), licence URL `https://scripts.sil.org/OFL`.
- Licence text: official `OFL.txt` fetched from `https://raw.githubusercontent.com/tokotype/PlusJakartaSans/master/OFL.txt` (HTTP 200) and shipped next to the files, as OFL §2 requires. No Reserved Font Name is declared; files are unmodified.
- Loaded with `next/font/local`: self-hosted, no runtime request to any external font host.

## API

- `type ThemeName = "light" | "dark"`; `UI_THEME_STORAGE_KEY = "courant-ui-theme"` (non-sensitive, stores only `light`/`dark`).
- Initial theme: valid stored choice ⇒ else system `prefers-color-scheme` ⇒ else `dark` (Delivo canonical). Storage access always in `try/catch`; unavailable storage ⇒ theme still works for the session, nothing thrown.
- `document.documentElement.dataset.uiTheme` is set by a tiny static inline script in `<head>` before first paint (no flash), then owned by the provider. The script is static (no interpolation) so a future CSP can allow it by SHA-256; its hash is pinned by a test: `'sha256-J2FpBxCekBVrTjaq4TnO+8/vssXIfydhqs7jBwDob8g='` (to be added to `script-src` if a page CSP is introduced). No CSP exists on pages today; none is weakened.
- `color-scheme` is applied by CSS ONLY inside the opt-in wrapper (`.ui-v2`), so non-migrated roles keep their current form controls.
- `meta[name="theme-color"]` is updated ONLY while at least one `ThemeSurface` is mounted, and the original value is restored when the last one unmounts (reversible). Non-migrated screens keep `#102a43`.
- System preference changes are followed only while no explicit user choice is stored; a cross-tab `storage` event with a valid value is applied.
- `ThemeToggle`: a real `<button>`, 44 px, visible focus, visible text « Thème sombre » with `aria-pressed` reflecting the state; before hydration it renders a same-size inert placeholder (no wrong state announced).

## Tokens and opt-in adoption

- New tokens only under `--ui-*` (e.g. `--ui-bg`, `--ui-surface`, `--ui-text`, `--ui-text-muted`, `--ui-primary` #18794E, `--ui-on-primary` #FFFFFF, `--ui-accent` #5BD49A (dark) / #0F5C3A (light), `--ui-advice` #F4D649 + `--ui-on-advice` #141414, `--ui-danger`, `--ui-warning`, `--ui-success`, `--ui-radius-*`, `--ui-space-*`, `--ui-font`), defined for `[data-ui-theme="dark"]` and `[data-ui-theme="light"]`.
- Consumed only inside `.ui-v2` (rendered by `ThemeSurface`). No screen is re-themed in this slice; nothing claims that the application theme is delivered. Yellow is reserved for advice. Statuses/errors in text meet AA in both themes.
- No floating debug button, no technical demo route.

## Tests (planned)

Resolution (stored valid / invalid / storage throwing / system dark / system light / no matchMedia), write with throwing storage, toggle persists and updates the attribute, system change ignored once a choice is stored, cross-tab event, meta theme-color set on first surface and restored after the last, inline script evaluated in a VM (stored, system, throwing storage) + pinned SHA-256, SSR render of provider + toggle (`react-dom/server`) with no theme-dependent attribute and no Auth data, strict `tsc`, existing UI suites unchanged. Real browser proof of the toggle comes with the public home slice, before announcing the application theme.

Root exact review before integration; no deployment by the lead; previews and app 28b untouched.

## Delivery notes (code commit)

- Storage events: a valid value for our key is applied; our key removed (`newValue` null) or `storage.clear()` (key null) ⇒ the explicit choice is dropped and the system preference applies again.
- `ThemeSurface` acquires meta management only once the controller exists; release is idempotent; the original `theme-color` is restored exactly when the last surface unmounts (verified with two surfaces and React StrictMode double mount).
- No screen opts in yet: `ThemeSurface` and `ThemeToggle` have no consumer in the app in this slice; the real browser proof inside the product comes with the public home slice.
