// UI theme foundation (UI-THEME-FOUNDATION-001). Pure logic, no React: resolution of the
// initial theme, guarded storage, the controller behind the provider, and the static anti-flash
// script. Only "light" / "dark" are ever stored under a non-sensitive key.

export type ThemeName = "light" | "dark";
export const UI_THEME_STORAGE_KEY = "courant-ui-theme";
export const UI_THEME_ATTRIBUTE = "data-ui-theme";
/** Theme used when neither a stored choice nor a system preference is available (Delivo canonical). */
export const DEFAULT_THEME: ThemeName = "dark";
/** Browser chrome colour while an opt-in surface is mounted (DESIGN.md backgrounds). */
export const THEME_COLOR: Record<ThemeName, string> = { dark: "#121417", light: "#FFFFFF" }; // palette B: anthracite dark bg

export const isThemeName = (value: unknown): value is ThemeName => value === "light" || value === "dark";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type MediaLike = { matches: boolean; addEventListener?: (type: "change", cb: (e: { matches: boolean }) => void) => void; removeEventListener?: (type: "change", cb: (e: { matches: boolean }) => void) => void };

/** Stored choice, or null if absent, invalid, or storage unavailable (never throws). */
export function readStoredTheme(storage: StorageLike | null | undefined): ThemeName | null {
  try {
    const value = storage?.getItem(UI_THEME_STORAGE_KEY);
    return isThemeName(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persists the choice; false when storage is unavailable (the theme still applies for the session). */
export function writeStoredTheme(storage: StorageLike | null | undefined, theme: ThemeName): boolean {
  try {
    if (!storage) return false;
    storage.setItem(UI_THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function systemTheme(media: MediaLike | null | undefined): ThemeName | null {
  if (!media) return null;
  return media.matches ? "dark" : "light";
}

/** Stored choice ⇒ system preference ⇒ default. */
export function resolveInitialTheme(input: { stored: ThemeName | null; system: ThemeName | null }): ThemeName {
  return input.stored ?? input.system ?? DEFAULT_THEME;
}

export type ThemeDocument = {
  documentElement: { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void };
  querySelector(selector: string): ThemeMeta | null;
  /** Optional: every meta theme-color (the layout may emit one per prefers-color-scheme). */
  querySelectorAll?(selector: string): ArrayLike<ThemeMeta>;
};
type ThemeMeta = { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void };

export type ThemeControllerDeps = {
  doc: ThemeDocument;
  storage: StorageLike | null;
  /** `matchMedia("(prefers-color-scheme: dark)")`, or null when unavailable. */
  media: MediaLike | null;
};

export type ThemeController = {
  get(): ThemeName;
  /** Explicit user choice: applied and persisted (persistence failure is tolerated). */
  set(theme: ThemeName): void;
  toggle(): void;
  /** Whether an explicit choice is stored (system changes are then ignored). */
  hasStoredChoice(): boolean;
  subscribe(listener: (theme: ThemeName) => void): () => void;
  /** System preference change (ignored once the user made an explicit choice). */
  onSystemChange(dark: boolean): void;
  /** Cross-tab `storage` event for our key. */
  onStorageEvent(key: string | null, value: string | null): void;
  /** Opt-in surfaces: meta theme-color is managed only while at least one is mounted. */
  acquireSurface(): () => void;
};

export function createThemeController(deps: ThemeControllerDeps): ThemeController {
  const fromDom = deps.doc.documentElement.getAttribute(UI_THEME_ATTRIBUTE);
  const stored = readStoredTheme(deps.storage);
  let explicit = stored !== null;
  let current: ThemeName = isThemeName(fromDom) ? fromDom : resolveInitialTheme({ stored, system: systemTheme(deps.media) });
  const listeners = new Set<(t: ThemeName) => void>();
  let surfaces = 0;
  // One entry per meta theme-color (light/dark media variants included): while a surface is
  // mounted the EXPLICIT theme wins over the media query, so every variant gets the same colour.
  let originals: { el: ThemeMeta; content: string | null }[] = [];

  const SELECTOR = 'meta[name="theme-color"]';
  const metas = (): ThemeMeta[] => {
    if (deps.doc.querySelectorAll) return Array.from(deps.doc.querySelectorAll(SELECTOR));
    const one = deps.doc.querySelector(SELECTOR);
    return one ? [one] : [];
  };
  const applyMeta = () => {
    if (surfaces > 0) for (const el of metas()) el.setAttribute("content", THEME_COLOR[current]);
  };
  const apply = (theme: ThemeName) => {
    current = theme;
    deps.doc.documentElement.setAttribute(UI_THEME_ATTRIBUTE, theme);
    applyMeta();
    for (const l of listeners) l(theme);
  };
  // The attribute is the single source of truth from now on (the inline script may have set it).
  deps.doc.documentElement.setAttribute(UI_THEME_ATTRIBUTE, current);

  return {
    get: () => current,
    set(theme) {
      if (!isThemeName(theme)) return;
      explicit = true;
      writeStoredTheme(deps.storage, theme);
      apply(theme);
    },
    toggle() {
      this.set(current === "dark" ? "light" : "dark");
    },
    hasStoredChoice: () => explicit,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onSystemChange(dark) {
      if (explicit) return;
      apply(dark ? "dark" : "light");
    },
    onStorageEvent(key, value) {
      // key === null: storage.clear() in another tab. Our key removed (value null) ⇒ the explicit
      // choice is gone everywhere: follow the system preference again.
      if (key !== null && key !== UI_THEME_STORAGE_KEY) return;
      if (isThemeName(value) && key === UI_THEME_STORAGE_KEY) {
        explicit = true;
        apply(value);
        return;
      }
      if (value === null) {
        explicit = false;
        apply(systemTheme(deps.media) ?? DEFAULT_THEME);
      }
    },
    acquireSurface() {
      if (surfaces === 0) originals = metas().map((el) => ({ el, content: el.getAttribute("content") }));
      surfaces += 1;
      applyMeta();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        surfaces -= 1;
        if (surfaces === 0) for (const { el, content } of originals) if (content !== null) el.setAttribute("content", content);
      };
    },
  };
}

/**
 * Static anti-flash script, inlined in <head> before first paint. No interpolation: its content is
 * constant so a future Content-Security-Policy can allow it by SHA-256 (pinned by a test).
 * Mirrors readStoredTheme / systemTheme / resolveInitialTheme; never throws.
 */
export const THEME_INIT_SCRIPT =
  '(function(){var t=null;try{var s=window.localStorage.getItem("courant-ui-theme");if(s==="light"||s==="dark")t=s}catch(e){}' +
  'if(!t){try{t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){}}' +
  'if(t!=="light"&&t!=="dark")t="dark";try{document.documentElement.setAttribute("data-ui-theme",t)}catch(e){}})();';
