"use client";
// Public chrome (UI-PUBLIC-REQUEST-001 P1): the themed header + footer shared by the public home,
// the request view and the account view. Extracted from PublicHome without visual change. Not a
// navigation system: every entry calls the existing PublicSession callbacks through
// `HomeHandlers`. In-page sections exist only on the home (buttons, never `href="#…"`); on the
// other views the brand and « Accueil » call `onHome` (session.go("home")).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Category } from "../app/types";
import { CATEGORIES } from "../app/format";
import { ThemeSurface } from "../app/theme-provider";
import { ThemeToggle } from "../app/theme-toggle";
import styles from "./public-chrome.module.css";

// ---- Actions: one table between rendered controls and the real session callbacks --------------
export type HomeTargetView = "help" | "pricing" | "join" | "about" | "privacy" | "legal";
export type HomeAction =
  | { type: "new"; category?: Category }
  | { type: "login" }
  | { type: "view"; view: HomeTargetView }
  | { type: "demo"; role?: "manager" };
export type HomeHandlers = {
  onNew(category?: Category): void;
  onLogin(): void;
  onNavigate(view: HomeTargetView): void;
  onDemo(role?: "manager"): void;
};
const TARGET_VIEWS: HomeTargetView[] = ["help", "pricing", "join", "about", "privacy", "legal"];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function runHomeAction(action: HomeAction, handlers: HomeHandlers): void {
  if (action.type === "new") {
    if (action.category) handlers.onNew(action.category);
    else handlers.onNew();
  } else if (action.type === "login") handlers.onLogin();
  else if (action.type === "view") handlers.onNavigate(action.view);
  else if (action.role) handlers.onDemo(action.role);
  else handlers.onDemo();
}
/** Stable key rendered as `data-home-action` (lets SSR tests replay every rendered control). */
export function actionKey(action: HomeAction): string {
  if (action.type === "new") return action.category ? `new:${action.category}` : "new";
  if (action.type === "view") return `view:${action.view}`;
  if (action.type === "demo") return action.role ? `demo:${action.role}` : "demo";
  return "login";
}
export function parseActionKey(key: string): HomeAction | null {
  const [type, arg, extra] = key.split(":");
  if (extra !== undefined) return null;
  if (type === "login" && arg === undefined) return { type: "login" };
  if (type === "new") {
    if (arg === undefined) return { type: "new" };
    return (CATEGORY_IDS as string[]).includes(arg) ? { type: "new", category: arg as Category } : null;
  }
  if (type === "view") return (TARGET_VIEWS as string[]).includes(arg ?? "") ? { type: "view", view: arg as HomeTargetView } : null;
  if (type === "demo") {
    if (arg === undefined) return { type: "demo" };
    return arg === "manager" ? { type: "demo", role: "manager" } : null;
  }
  return null;
}

/** Props for a button that runs `action` (and closes the menu first when given). */
export function actionButton(action: HomeAction, handlers: HomeHandlers, before?: () => void) {
  return {
    type: "button" as const,
    "data-home-action": actionKey(action),
    onClick: () => {
      before?.();
      runHomeAction(action, handlers);
    },
  };
}

const NAV_VIEWS: { view: HomeTargetView; label: string }[] = [
  { view: "pricing", label: "Tarifs" },
  { view: "join", label: "Vous êtes artisan ?" },
];
const FOOTER_VIEWS: { view: HomeTargetView; label: string }[] = [
  { view: "help", label: "Aide" },
  { view: "about", label: "À propos" },
  { view: "privacy", label: "Confidentialité" },
  { view: "legal", label: "Mentions légales" },
];

export type ChromeView = "home" | "new" | "auth";
export type ChromeSection = { id: string; label: string };

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22">
        <path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z" fill="currentColor" />
      </svg>
    </span>
  );
}

export function PublicChrome({
  current,
  handlers,
  onHome,
  sections,
  onSection,
  className,
  mainClassName,
  footerNote,
  children,
}: {
  current: ChromeView;
  handlers: HomeHandlers;
  /** Brand / « Accueil »: on the home, back to the top; elsewhere session.go("home"). */
  onHome: () => void;
  /** Home only: in-page sections (scroll + focus, never the hash). */
  sections?: ChromeSection[];
  onSection?: (id: string) => void;
  className?: string;
  mainClassName?: string;
  footerNote?: ReactNode;
  children: ReactNode;
}) {
  const navId = `${useId()}-nav`;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuToggle.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const close = () => setMenuOpen(false);
  const act = (action: HomeAction) => actionButton(action, handlers, close);
  const home = () => {
    close();
    onHome();
  };

  return (
    <ThemeSurface className={className ? `${styles.chrome} ${className}` : styles.chrome}>
      <header className={styles.topbar}>
        <div className={`${styles.wrap} ${styles.topbarInner}`}>
          <button type="button" className={styles.brand} aria-label="Courant, accueil" aria-current={current === "home" ? "page" : undefined} data-chrome-home="" onClick={home}>
            <BrandMark />
            <span className={styles.brandText}>
              <strong>Courant</strong>
              <small>Nom de travail</small>
            </span>
          </button>
          <nav id={navId} className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`} aria-label="Navigation principale">
            {current === "home" && sections
              ? sections.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={styles.navLink}
                    data-home-anchor={item.id}
                    onClick={() => {
                      close();
                      onSection?.(item.id);
                    }}
                  >
                    {item.label}
                  </button>
                ))
              : (
                  <button type="button" className={styles.navLink} data-chrome-home="" onClick={home}>
                    Accueil
                  </button>
                )}
            {NAV_VIEWS.map((item) => (
              <button key={item.view} className={styles.navLink} {...act({ type: "view", view: item.view })}>
                {item.label}
              </button>
            ))}
            <button className={`${styles.navLink} ${styles.navLogin}`} aria-current={current === "auth" ? "page" : undefined} {...act({ type: "login" })}>
              Se connecter
            </button>
          </nav>
          <div className={styles.topbarActions}>
            <ThemeToggle className={styles.themeToggle} />
            <button className={`${styles.btn} ${styles.btnGhost} ${styles.loginButton}`} aria-current={current === "auth" ? "page" : undefined} {...act({ type: "login" })}>
              Se connecter
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary} ${styles.headerCta}`} aria-current={current === "new" ? "page" : undefined} {...act({ type: "new" })}>
              Décrire ma panne
            </button>
            <button ref={menuToggle} type="button" className={styles.menuButton} aria-expanded={menuOpen} aria-controls={navId} aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"} onClick={() => setMenuOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d={menuOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main id="main" className={mainClassName}>
        {children}
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerInner}`}>
          <span className={styles.brandText}>
            <strong>Courant</strong>
            <small>Nom de travail. Application en préparation.</small>
          </span>
          <nav className={styles.footerNav} aria-label="Informations">
            {FOOTER_VIEWS.map((item) => (
              <button key={item.view} {...act({ type: "view", view: item.view })}>
                {item.label}
              </button>
            ))}
            <button {...act({ type: "demo", role: "manager" })}>Démonstration espace professionnel</button>
          </nav>
          {footerNote && <p className={styles.credits}>{footerNote}</p>}
        </div>
      </footer>
    </ThemeSurface>
  );
}
