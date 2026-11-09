"use client";
// Direct site read for a sheet opened by id when the site is absent from the workspace cache
// (portfolio page > 1, archived site): exact GET /api/sites/:id/settings under the current identity,
// refused honestly when the site belongs to another organisation. StrictMode-safe, identity guard.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SL_CONTEXT, SETTINGS_INITIAL, applySettings, createSlApi, type SettingsState, type SiteRecord, type SlApi, type SlContext } from "./site-lifecycle-model";
import styles from "./site-lifecycle.module.css";

export const DIRECT_COPY = {
  loading: "Lecture du site…",
  notFound: "Ce site est introuvable ou n’est plus accessible.",
  failed: "Le site n’a pas pu être lu. Rien n’a été modifié : réessayez.",
  otherOrganization: "Ce site n’appartient pas à l’organisation active : il n’est pas affiché ici.",
  demo: "Démonstration : ce site n’existe pas dans les données de démonstration ; aucune lecture n’est faite.",
} as const;
export type DirectPhase = "loading" | "ready" | "not_found" | "error" | "other_org" | "demo";

/** Pure decision on a settings read (organisation check included). */
export function directOutcome(s: SettingsState, organizationId: string | null): DirectPhase {
  if (s.phase === "demo") return "demo";
  if (s.phase === "loading") return "loading";
  if (s.phase === "unavailable") return "not_found";
  if (s.phase === "error" || !s.site) return "error";
  return organizationId && s.site.organization_id.toLowerCase() === organizationId.toLowerCase() ? "ready" : "other_org";
}

export function createDirectController({ api, siteId, context = DEFAULT_SL_CONTEXT, get, set, demo = false }: { api: () => SlApi; siteId: string; context?: SlContext; get: () => SettingsState; set: (s: SettingsState) => void; demo?: boolean }) {
  const gen = context.generation();
  const uid = context.userId();
  let attached = true;
  let seq = 0;
  return {
    async load(): Promise<boolean> {
      if (demo) {
        set({ ...get(), phase: "demo" });
        return false;
      }
      const mine = ++seq;
      // E57 (P3): a re-read of a site already shown keeps it mounted (its confirmation stays) until
      // the reply; only a first read starts from the loading state.
      if (!get().site) set({ ...SETTINGS_INITIAL });
      const r = await api().settings(siteId);
      if (!attached || mine !== seq || context.generation() !== gen || context.userId() !== uid) return false;
      set(applySettings(get(), r, siteId));
      return true;
    },
    detach() {
      attached = false;
    },
  };
}

export type SiteDirectLoaderProps = {
  siteId: string;
  /** Active organisation: a site of another organisation is refused. */
  organizationId: string | null;
  api?: SlApi;
  context?: SlContext;
  demo?: boolean;
  /** Rendered only for a site of the active organisation. `state` can seed SiteSettingsPanel. */
  render: (site: SiteRecord, state: SettingsState, reload: () => void) => ReactNode;
  /** Back action shown with refusals. */
  back?: ReactNode;
  /** Tests only. */
  initial?: SettingsState;
};
export function SiteDirectLoader(props: SiteDirectLoaderProps) {
  const ctx = props.context ?? DEFAULT_SL_CONTEXT;
  return <DirectInner key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.demo ? "demo" : "live"}|${props.siteId}`} {...props} />;
}
function DirectInner({ siteId, organizationId, api, context = DEFAULT_SL_CONTEXT, demo = false, render, back, initial }: SiteDirectLoaderProps) {
  const [state, setRaw] = useState<SettingsState>(initial ?? (demo ? { ...SETTINGS_INITIAL, phase: "demo" } : SETTINGS_INITIAL));
  const ref = useRef(state);
  const set = (next: SettingsState) => {
    ref.current = next;
    setRaw(next);
  };
  const latest = useRef({ api });
  latest.current = { api };
  const controller = useRef<ReturnType<typeof createDirectController> | null>(null);
  useEffect(() => {
    let client: SlApi | null = null;
    const c = createDirectController({ api: () => (client ??= latest.current.api ?? createSlApi()), siteId, context, demo, get: () => ref.current, set });
    controller.current = c;
    if (!initial) void c.load();
    return () => {
      c.detach();
      if (controller.current === c) controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const outcome = directOutcome(state, organizationId);
  const reload = () => void controller.current?.load();
  if (outcome === "ready") return <>{render(state.site!, state, reload)}</>;
  return (
    <section className={styles.panel} data-site-direct={outcome}>
      {outcome === "loading" && <p className={styles.muted} role="status">{DIRECT_COPY.loading}</p>}
      {outcome === "demo" && <p className={styles.note} role="note">{DIRECT_COPY.demo}</p>}
      {outcome === "not_found" && <p className={styles.note} role="status">{DIRECT_COPY.notFound}</p>}
      {outcome === "other_org" && <p className={styles.note} role="alert">{DIRECT_COPY.otherOrganization}</p>}
      {outcome === "error" && (
        <>
          <p className={styles.error} role="alert">{DIRECT_COPY.failed}</p>
          <button type="button" className={styles.button} onClick={reload} data-site-direct-retry="">Réessayer</button>
        </>
      )}
      {outcome !== "loading" && outcome !== "error" && back}
    </section>
  );
}
