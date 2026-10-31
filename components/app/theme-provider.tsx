"use client";
// UI theme provider (UI-THEME-FOUNDATION-001). Owns the `data-ui-theme` attribute after the
// inline script set it, follows the system preference until the user chooses, syncs other tabs,
// and lets opt-in surfaces (`ThemeSurface`) manage meta theme-color reversibly. Nothing here is
// rendered differently on the server and on the first client render (theme is null until mounted).
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createThemeController, type MediaLike, type StorageLike, type ThemeController, type ThemeName } from "./theme";

type ThemeContextValue = {
  /** null until mounted (server render and first client render are identical). */
  theme: ThemeName | null;
  setTheme(theme: ThemeName): void;
  toggle(): void;
  /** Internal: opt-in surfaces register to manage meta theme-color. */
  acquireSurface(): () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function safeStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function safeMedia(): MediaLike | null {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children, controllerFactory }: { children: ReactNode; controllerFactory?: () => ThemeController }) {
  const controller = useRef<ThemeController | null>(null);
  const [theme, setThemeState] = useState<ThemeName | null>(null);

  useEffect(() => {
    const c = controllerFactory ? controllerFactory() : createThemeController({ doc: document, storage: safeStorage(), media: safeMedia() });
    controller.current = c;
    setThemeState(c.get());
    const unsubscribe = c.subscribe(setThemeState);
    const media = safeMedia();
    const onMedia = (e: { matches: boolean }) => c.onSystemChange(e.matches);
    media?.addEventListener?.("change", onMedia);
    const onStorage = (e: StorageEvent) => c.onStorageEvent(e.key, e.newValue);
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      media?.removeEventListener?.("change", onMedia);
      window.removeEventListener("storage", onStorage);
      controller.current = null;
    };
    // controllerFactory is a test seam, read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (t) => controller.current?.set(t),
      toggle: () => controller.current?.toggle(),
      // Surfaces acquire only once the controller exists (ThemeSurface waits for theme !== null).
      acquireSurface: () => controller.current?.acquireSurface() ?? (() => undefined),
    }),
    [theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useUiTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useUiTheme must be used inside ThemeProvider");
  return ctx;
}

/**
 * Opt-in wrapper for migrated screens: applies the `--ui-*` tokens, the local font and the
 * colour scheme to its subtree only, and keeps meta theme-color in sync while mounted (restored
 * exactly when the last surface unmounts). Non-migrated screens never render it.
 */
export function ThemeSurface({ children, className }: { children: ReactNode; className?: string }) {
  const { theme, acquireSurface } = useUiTheme();
  useEffect(() => {
    if (theme === null) return; // wait for the controller (mounted)
    return acquireSurface();
    // re-acquire only when the controller becomes available, not on every theme change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme === null]);
  return <div className={className ? `ui-v2 ${className}` : "ui-v2"}>{children}</div>;
}
