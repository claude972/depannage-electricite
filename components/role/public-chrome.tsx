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
import { Icon } from "../app/icons";
import styles from "./public-chrome.module.css";

// ---- Actions: one table between rendered controls and the real session callbacks --------------
export type HomeTargetView = "help" | "pricing" | "join" | "about" | "privacy" | "legal";
export type HomeAction =
  | { type: "new"; category?: Category }
  | { type: "login" }
  | { type: "address" }
  | { type: "view"; view: HomeTargetView }
  | { type: "demo"; role?: "manager" };
export type HomeHandlers = {
  onNew(category?: Category): void;
  onLogin(): void;
  onAddress?(): void;
  onNavigate(view: HomeTargetView): void;
  onDemo(role?: "manager"): void;
};
const TARGET_VIEWS: HomeTargetView[] = ["help", "pricing", "join", "about", "privacy", "legal"];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function runHomeAction(action: HomeAction, handlers: HomeHandlers): void {
  if (action.type === "new") {
    if (action.category) handlers.onNew(action.category);
    else handlers.onNew();
  } else if (action.type === "address") (handlers.onAddress ?? handlers.onNew)();
  else if (action.type === "login") handlers.onLogin();
  else if (action.type === "view") handlers.onNavigate(action.view);
  else if (action.role) handlers.onDemo(action.role);
  else handlers.onDemo();
}
/** Stable key rendered as `data-home-action` (lets SSR tests replay every rendered control). */
export function actionKey(action: HomeAction): string {
  if (action.type === "new") return action.category ? `new:${action.category}` : "new";
  if (action.type === "view") return `view:${action.view}`;
  if (action.type === "demo") return action.role ? `demo:${action.role}` : "demo";
  return action.type;
}
export function parseActionKey(key: string): HomeAction | null {
  const [type, arg, extra] = key.split(":");
  if (extra !== undefined) return null;
  if ((type === "login" || type === "address") && arg === undefined) return { type };
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

/** Navigation back to the public app from a standalone catalogue or service page. */
export function serviceChromeHref(action: HomeAction | { type: "home" }): string {
  if (action.type === "new") return action.category ? `/#new/${action.category}` : "/#new";
  if (action.type === "address") return "/#new/address";
  if (action.type === "login") return "/#auth";
  if (action.type === "view") return `/#${action.view}`;
  if (action.type === "demo") return `/#demo/${action.role ?? "client"}`;
  return "/";
}

export function serviceChromeHandlers(go: (href: string) => void = (href) => window.location.assign(href)): HomeHandlers {
  return {
    onNew: (category) => go(serviceChromeHref({ type: "new", category })),
    onAddress: () => go(serviceChromeHref({ type: "address" })),
    onLogin: () => go(serviceChromeHref({ type: "login" })),
    onNavigate: (view) => go(serviceChromeHref({ type: "view", view })),
    onDemo: (role) => go(serviceChromeHref({ type: "demo", role })),
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

/** Current public view: home/new/auth have their own header controls; informational views are
 *  marked in the nav or footer link that opens them. */
export type ChromeView = "home" | "new" | "auth" | HomeTargetView | (string & {});
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
  appNavigation = false,
  editorial = false,
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
  appNavigation?: boolean;
  editorial?: boolean;
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

  const surface = [styles.chrome, appNavigation ? styles.appChrome : "", editorial ? styles.editorialChrome : "", className].filter(Boolean).join(" ");
  const navigation = (
    <nav id={navId} className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`} aria-label="Navigation principale">
      {(editorial || current !== "home" || !sections) && (
        <button type="button" className={styles.navLink} data-chrome-home="" onClick={home}>Accueil</button>
      )}
      {current === "home" && sections?.map((item) => (
        <button type="button" key={item.id} className={styles.navLink} data-home-anchor={item.id} onClick={() => { close(); onSection?.(item.id); }}>
          {item.label}
        </button>
      ))}
      {editorial ? (
        <>
          {current !== "home" && <a className={styles.navLink} href="/prestations">Services</a>}
          <a className={styles.navLink} href="/suivi">Activité</a>
          <button className={styles.navLink} {...act({ type: "login" })}>Compte</button>
        </>
      ) : (
        <>
          {NAV_VIEWS.map((item) => (
            <button key={item.view} className={styles.navLink} aria-current={current === item.view ? "page" : undefined} {...act({ type: "view", view: item.view })}>
              {item.label}
            </button>
          ))}
          <button className={`${styles.navLink} ${styles.navLogin}`} aria-current={current === "auth" ? "page" : undefined} {...act({ type: "login" })}>Se connecter</button>
        </>
      )}
    </nav>
  );
  const menu = (
    <button ref={menuToggle} type="button" className={styles.menuButton} aria-expanded={menuOpen} aria-controls={navId} aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"} onClick={() => setMenuOpen((open) => !open)}>
      <Icon name={menuOpen ? "close" : "menu"} size={22} />
    </button>
  );

  return (
    <ThemeSurface className={surface} appearance={editorial ? "light" : undefined}>
      <header className={styles.topbar}>
        <div className={`${styles.wrap} ${styles.topbarInner}`}>
          <button type="button" className={styles.brand} aria-label="Accueil" aria-current={current === "home" ? "page" : undefined} data-chrome-home="" onClick={home}>
            <BrandMark />
            <span className={styles.brandText}>
              <strong>Dépannage</strong>
              <small className={styles.brandKind}>{editorial ? "électrique" : "ÉLECTRIQUE"}</small>
            </span>
          </button>
          {editorial ? (
            <>
              <button className={styles.recruit} {...act({ type: "view", view: "join" })}>
                <Icon name="briefcase" size={20} /><span><strong>Rejoindre le réseau</strong><small>Candidature électricien</small></span>
              </button>
              <div className={styles.editorialActions}>
                <a className={styles.follow} href="/suivi">Suivre mon intervention</a>
                <a className={styles.contact} href="/#help/contact"><Icon name="mail" size={16} />Nous contacter</a>
              </div>
              <div className={styles.menuWrap}>{menu}{navigation}</div>
            </>
          ) : (
            <>
              {navigation}
              <div className={styles.topbarActions}>
                <ThemeToggle className={styles.themeToggle} />
                <button className={`${styles.btn} ${styles.btnGhost} ${styles.loginButton}`} aria-current={current === "auth" ? "page" : undefined} {...act({ type: "login" })}>Se connecter</button>
              <button className={`${styles.btn} ${styles.btnPrimary} ${styles.headerCta}`} aria-current={current === "new" ? "page" : undefined} {...act({ type: "new" })}>
                Décrire ma panne
              </button>
                {menu}
              </div>
            </>
          )}
        </div>
      </header>

      <main id="main" className={mainClassName}>
        {children}
      </main>

      <footer className={styles.footer}>
        {editorial ? (
          <div className={`${styles.wrap} ${styles.editorialFooter}`}>
            <div>
              <strong>Dépannage électrique</strong>
              <p>De la demande au suivi de votre intervention électrique.</p>
            </div>
            <nav aria-label="Services et tarifs">
              <strong>Services</strong>
              <a href="/prestations">Voir les dépannages</a>
              <button {...act({ type: "view", view: "pricing" })}>Tarifs indicatifs</button>
              <a href="/#pricing/zones">Zones d’intervention</a>
            </nav>
            <nav aria-label="Assistance et suivi">
              <strong>Assistance</strong>
              <a href="/suivi">Suivre mon intervention</a>
              <a href="/#help/contact">Nous contacter</a>
              <a href="/#help/garantie">Garantie</a>
            </nav>
            <nav aria-label="À propos et mentions">
              <strong>À propos</strong>
              <button {...act({ type: "view", view: "join" })}>Candidature électricien</button>
              <a href="/conseils">Le blog du dépannage</a>
              {FOOTER_VIEWS.filter(({ view }) => view !== "help").map((item) => (
                <button key={item.view} {...act({ type: "view", view: item.view })}>{item.label}</button>
              ))}
              <button {...act({ type: "demo", role: "manager" })}>Démonstration espace professionnel</button>
            </nav>
            {footerNote && <p className={styles.credits}>{footerNote}</p>}
          </div>
        ) : (
        <div className={`${styles.wrap} ${styles.footerInner}`}>
          <span className={styles.brandText}>
            <strong>Dépannage électrique</strong>
            <small>Application en préparation.</small>
          </span>
          <nav className={styles.footerNav} aria-label="Informations">
            {FOOTER_VIEWS.map((item) => (
              <button key={item.view} aria-current={current === item.view ? "page" : undefined} {...act({ type: "view", view: item.view })}>
                {item.label}
              </button>
            ))}
            <button {...act({ type: "demo", role: "manager" })}>Démonstration espace professionnel</button>
          </nav>
          {footerNote && <p className={styles.credits}>{footerNote}</p>}
        </div>
        )}
      </footer>
      {appNavigation && (
        <nav className={styles.appNav} aria-label="Navigation rapide">
          <button type="button" aria-current="page" onClick={home}><Icon name="home" size={20} /> Accueil</button>
          <button type="button" onClick={() => onSection?.("accueil-services")}><Icon name="list" size={20} /> Services</button>
          <a href="/suivi"><Icon name="document" size={20} /> Activité</a>
          <button {...act({ type: "login" })}><Icon name="person" size={20} /> Compte</button>
        </nav>
      )}
    </ThemeSurface>
  );
}
