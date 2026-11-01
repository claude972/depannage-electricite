"use client";

import { useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

// This event is a browser capability, not account/session data. No user data is stored.
let installPrompt: InstallPromptEvent | null = null;
const INSTALL_EVENT = "courant:install-available";
// Styles (DESIGN.md green / Plus Jakarta / light-dark). Base rules = the former inline styles,
// unchanged, so pages without the new theme look exactly as before. The --ui-* tokens are defined
// on :root (app/globals.css), so a var() fallback would never apply: the themed variant is opt-in
// by ancestry. The status notice is mounted in app/layout.tsx, outside any ThemeSurface: it is
// themed only when the page renders a `.ui-v2` surface (`body:has(.ui-v2)`; browsers without :has
// keep the legacy look). The install control lives inside the role spaces: themed under `.ui-v2`.
// Shipped as a React 19 hoisted, deduplicated <style> (no CSS import, so node tests can load
// this module directly). Class names are prefixed `pwa-`.
const PWA_CSS = `
.pwa-notice {
  position: relative;
  z-index: 100;
  padding: 12px 20px;
  color: #172b4d;
  background: #fff8e8;
  border-bottom: 1px solid #d8e0eb;
  font-size: 14px;
  line-height: 1.5;
}
.pwa-button {
  min-height: 44px;
  padding: 8px 14px;
  margin-left: 8px;
  border: 1px solid #1457d9;
  border-radius: 8px;
  background: white;
  color: #1457d9;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}
.pwa-install {
  line-height: 1.5;
}
.pwa-install .pwa-button {
  margin-left: 0;
}
.pwa-summary {
  cursor: pointer;
  min-height: 44px;
  padding: 10px 0;
}
.pwa-note {
  font-size: 14px;
  color: #526178;
}

/* ===== Themed (DESIGN.md: green accent, Plus Jakarta Sans, light/dark) ======================= */
body:has(.ui-v2) .pwa-notice {
  color: var(--ui-text);
  background: var(--ui-surface);
  border-bottom-color: var(--ui-border);
  box-shadow: inset 4px 0 0 var(--ui-warning);
  font-family: var(--ui-font);
  color-scheme: var(--ui-scheme);
}
body:has(.ui-v2) .pwa-notice .pwa-button,
.ui-v2 .pwa-install .pwa-button {
  border-color: var(--ui-accent);
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-accent);
}
body:has(.ui-v2) .pwa-notice .pwa-button:hover:not(:disabled),
.ui-v2 .pwa-install .pwa-button:hover:not(:disabled) {
  background: var(--ui-card);
}
body:has(.ui-v2) .pwa-notice .pwa-button:focus-visible,
.ui-v2 .pwa-install .pwa-button:focus-visible,
.ui-v2 .pwa-install .pwa-summary:focus-visible {
  outline: 3px solid var(--ui-focus);
  outline-offset: 2px;
}
.ui-v2 .pwa-install .pwa-summary {
  color: var(--ui-text);
}
.ui-v2 .pwa-install .pwa-note {
  color: var(--ui-text-muted);
}
`;
function PwaStyles() {
  return (
    <style href="courant-pwa-registration" precedence="default">
      {PWA_CSS}
    </style>
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Called only after the user explicitly accepts a reload, including stale multi-tab updates. */
export function requestPwaUpdate(
  worker: Pick<ServiceWorker, "state" | "postMessage">,
  currentController: ServiceWorker | null,
  reload: () => void,
) {
  if (worker.state !== "installed" || currentController === worker) {
    // Another tab may already have activated (or superseded) the waiting worker.
    // Posting skipWaiting to it would not produce another controllerchange event.
    reload();
    return;
  }
  worker.postMessage({ type: "ACTIVATE_UPDATE" });
}

/** Observe real installation outcomes; register() resolving is not proof of a usable worker. */
export function observePwaInstallation(
  worker: Pick<ServiceWorker, "state" | "addEventListener" | "removeEventListener">,
  onInstalled: () => void,
  onFailed: () => void,
) {
  let reachedInstalled = false;
  const onStateChange = () => {
    if (["installed", "activating", "activated"].includes(worker.state)) {
      reachedInstalled = true;
      onInstalled();
    } else if (worker.state === "redundant" && !reachedInstalled) {
      onFailed();
    }
  };
  worker.addEventListener("statechange", onStateChange);
  onStateChange();
  return () => worker.removeEventListener("statechange", onStateChange);
}

/** Only generic network/update status. This component never reads user data. */
export function PwaRegistration() {
  const [offline, setOffline] = useState(false);
  const [registrationError, setRegistrationError] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [activating, setActivating] = useState(false);
  const [retry, setRetry] = useState(0);
  const reloadRequested = useRef(false);

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      installPrompt = event as InstallPromptEvent;
      window.dispatchEvent(new Event(INSTALL_EVENT));
    };
    const onInstalled = () => {
      installPrompt = null;
      window.dispatchEvent(new Event(INSTALL_EVENT));
    };
    setOffline(!navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    let alive = true;
    let registration: ServiceWorkerRegistration | undefined;
    const observedWorkers = new Map<ServiceWorker, () => void>();
    const onControllerChange = () => {
      if (alive && navigator.serviceWorker.controller) setRegistrationError(false);
      // Never reload an in-progress form merely because a worker activated.
      if (reloadRequested.current) window.location.reload();
    };
    const inspectWaiting = () => {
      if (alive && registration?.waiting && navigator.serviceWorker.controller) {
        setWaiting(registration.waiting);
      }
    };
    const observeInstallation = () => {
      const worker = registration?.installing;
      if (!worker || observedWorkers.has(worker)) return;
      const stopObserving = observePwaInstallation(
        worker,
        () => {
          if (!alive) return;
          setRegistrationError(false);
          inspectWaiting();
        },
        () => {
          if (!alive) return;
          setWaiting(null);
          setActivating(false);
          setRegistrationError(true);
        },
      );
      observedWorkers.set(worker, stopObserving);
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    // Next's public worker registration pattern; bypass HTTP cache for version checks.
    // https://nextjs.org/docs/app/guides/progressive-web-apps
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((result) => {
        if (!alive) return;
        registration = result;
        setRegistrationError(false);
        registration.addEventListener("updatefound", observeInstallation);
        inspectWaiting();
        observeInstallation();
        if (!registration.active && !registration.waiting && !registration.installing) {
          // A very fast install failure can precede the registration promise callback.
          setRegistrationError(true);
        }
      })
      .catch(() => {
        if (alive) setRegistrationError(true);
      });
    return () => {
      alive = false;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      registration?.removeEventListener("updatefound", observeInstallation);
      for (const stopObserving of observedWorkers.values()) stopObserving();
    };
  }, [retry]);

  if (offline) {
    return (
      <div role="status" className="pwa-notice">
        <PwaStyles />
        Connexion interrompue. Les actions ne sont pas envoyées hors connexion.
        Vérifiez leur état avant de réessayer au retour du réseau.
      </div>
    );
  }
  if (waiting) {
    return (
      <div role="status" className="pwa-notice">
        <PwaStyles />
        Une nouvelle version est disponible. Enregistrez vos saisies avant de recharger.
        <button
          type="button"
          disabled={activating}
          className="pwa-button"
          onClick={() => {
            reloadRequested.current = true;
            setActivating(true);
            requestPwaUpdate(waiting, navigator.serviceWorker.controller, () => window.location.reload());
          }}
        >
          {activating ? "Actualisation…" : "Recharger maintenant"}
        </button>
      </div>
    );
  }
  if (registrationError) {
    return (
      <div role="status" className="pwa-notice">
        <PwaStyles />
        L’installation n’est pas disponible pour le moment. Le site reste accessible en ligne.
        <button type="button" className="pwa-button" onClick={() => setRetry((value) => value + 1)}>
          Réessayer
        </button>
      </div>
    );
  }
  return null;
}

/** Place this control in profile/help navigation. Installation remains a user action. */
export function PwaInstallControl() {
  const [installed, setInstalled] = useState(true);
  const [available, setAvailable] = useState(false);
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const update = () => {
      setInstalled(isStandalone());
      setAvailable(installPrompt !== null);
    };
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );
    update();
    window.addEventListener(INSTALL_EVENT, update);
    window.addEventListener("appinstalled", update);
    media.addEventListener("change", update);
    return () => {
      window.removeEventListener(INSTALL_EVENT, update);
      window.removeEventListener("appinstalled", update);
      media.removeEventListener("change", update);
    };
  }, []);

  async function install() {
    const prompt = installPrompt;
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setError("L’installation n’a pas pu démarrer. Utilisez le menu de votre navigateur.");
    } finally {
      // Chromium install prompts are single-use, including after dismissal.
      if (installPrompt === prompt) installPrompt = null;
      window.dispatchEvent(new Event(INSTALL_EVENT));
      setBusy(false);
    }
  }

  if (installed) return null;
  return (
    <section aria-label="Installer l’application" className="pwa-install">
      <PwaStyles />
      {available ? (
        <button type="button" disabled={busy} onClick={install} className="pwa-button">
          {busy ? "Ouverture…" : "Installer Courant"}
        </button>
      ) : (
        <details>
          <summary className="pwa-summary">
            Installer sur cet appareil
          </summary>
          <p>
            {ios
              ? "Dans Safari, ouvrez Partager, puis choisissez Sur l’écran d’accueil."
              : "Ouvrez le menu de votre navigateur et choisissez Installer l’application ou Ajouter à l’écran d’accueil, si cette option est proposée."}
          </p>
        </details>
      )}
      <p className="pwa-note">
        Une connexion Internet reste nécessaire pour consulter et modifier vos dossiers.
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
