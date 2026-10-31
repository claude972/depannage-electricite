"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

// This event is a browser capability, not account/session data. No user data is stored.
let installPrompt: InstallPromptEvent | null = null;
const INSTALL_EVENT = "courant:install-available";
const noticeStyle: CSSProperties = {
  position: "relative",
  zIndex: 100,
  padding: "12px 20px",
  color: "#172b4d",
  background: "#fff8e8",
  borderBottom: "1px solid #d8e0eb",
  fontSize: "14px",
  lineHeight: 1.5,
};
const buttonStyle: CSSProperties = {
  minHeight: 44,
  padding: "8px 14px",
  marginLeft: 8,
  border: "1px solid #1457d9",
  borderRadius: 8,
  background: "white",
  color: "#1457d9",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
};

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
      const onStateChange = () => {
        if (worker.state === "installed") inspectWaiting();
      };
      worker.addEventListener("statechange", onStateChange);
      observedWorkers.set(worker, onStateChange);
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
        inspectWaiting();
        observeInstallation();
        registration.addEventListener("updatefound", observeInstallation);
      })
      .catch(() => {
        if (alive) setRegistrationError(true);
      });
    return () => {
      alive = false;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      registration?.removeEventListener("updatefound", observeInstallation);
      for (const [worker, listener] of observedWorkers) {
        worker.removeEventListener("statechange", listener);
      }
    };
  }, [retry]);

  if (offline) {
    return (
      <div role="status" style={noticeStyle}>
        Connexion interrompue. Les actions ne sont pas envoyées hors connexion.
        Vérifiez leur état avant de réessayer au retour du réseau.
      </div>
    );
  }
  if (waiting) {
    return (
      <div role="status" style={noticeStyle}>
        Une nouvelle version est disponible. Enregistrez vos saisies avant de recharger.
        <button
          type="button"
          disabled={activating}
          style={buttonStyle}
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
      <div role="status" style={noticeStyle}>
        L’installation n’est pas disponible pour le moment. Le site reste accessible en ligne.
        <button type="button" style={buttonStyle} onClick={() => setRetry((value) => value + 1)}>
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
    <section aria-label="Installer l’application" style={{ lineHeight: 1.5 }}>
      {available ? (
        <button type="button" disabled={busy} onClick={install} style={{ ...buttonStyle, marginLeft: 0 }}>
          {busy ? "Ouverture…" : "Installer Courant"}
        </button>
      ) : (
        <details>
          <summary style={{ cursor: "pointer", minHeight: 44, padding: "10px 0" }}>
            Installer sur cet appareil
          </summary>
          <p>
            {ios
              ? "Dans Safari, ouvrez Partager, puis choisissez Sur l’écran d’accueil."
              : "Ouvrez le menu de votre navigateur et choisissez Installer l’application ou Ajouter à l’écran d’accueil, si cette option est proposée."}
          </p>
        </details>
      )}
      <p style={{ fontSize: 14, color: "#526178" }}>
        Une connexion Internet reste nécessaire pour consulter et modifier vos dossiers.
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
