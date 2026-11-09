"use client";
// Web push enrollment for this browser (mounted in the shared PreferencesPanel). Offered only once
// the push PREFERENCE is saved and the service worker answers PRIVATE_PUSH_READY in time. The
// registration and the decoded key are prepared BEFORE the click; the click calls
// pushManager.subscribe synchronously (no await before it). Reuse an existing subscription only if
// its key equals the server key; otherwise reset it on an explicit click. After an error, a lost
// reply or a 409: re-read only, never an automatic (re)registration. Endpoint/keys never stored or
// logged; identity (uid + generation) checked after permission and before the POST; a reply after an
// identity change or an unmount is ignored. Demo: honest note, zero calls. Logic: ./model.
import { useEffect, useRef, useState } from "react";
import { COPY, pushTag, browserEnv, checkReady, createPushApi, keyBytes, parsePushView, sameKey, subscriptionBody, type Context, type PushApi, type PushEnv, type PushReg, type PushSub, type PushTag, type PushView } from "./model";
import styles from "./web-push.module.css";

export type WebPushPanelProps = {
  demo: boolean;
  /** Saved (server-confirmed) push preference — never the unsaved checkbox. */
  pushSaved: boolean;
  context: Context;
  api?: PushApi;
  env?: PushEnv;
  readyTimeoutMs?: number;
  /** Reports the channel tag the preferences may show (server-confirmed only). */
  onTag?: (tag: PushTag) => void;
};
type Phase = "checking" | "unsupported" | "unavailable" | "needPreference" | "notReady" | "ready" | "error" | "forbidden";
type Prep = { reg: PushReg; bytes: Uint8Array; existing: PushSub | null; matches: boolean };

export function WebPushPanel(props: WebPushPanelProps) {
  if (props.demo)
    return (
      <div className={styles.panel} data-web-push="demo">
        <strong>{COPY.title}</strong>
        <p className={styles.hint}>{COPY.demo}</p>
      </div>
    );
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.pushSaved ? "on" : "off"}`} {...props} />;
}

function Live({ pushSaved, context, api, env, readyTimeoutMs, onTag }: WebPushPanelProps) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [data, setData] = useState<PushView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsReset, setNeedsReset] = useState(false);
  const prep = useRef<Prep | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);
  const deps = useRef({ api: api ?? createPushApi(), env: env ?? browserEnv(), context });
  deps.current.context = context;
  const who = () => ({ uid: deps.current.context.userId(), gen: deps.current.context.generation() });
  const same = (w: { uid: string | null; gen: number }) => alive.current && deps.current.context.userId() === w.uid && deps.current.context.generation() === w.gen;

  const load = async (keepNotice = false) => {
    const my = ++seq.current;
    const w = who();
    const { api: a, env: e } = deps.current;
    if (!keepNotice) setNotice("");
    setError("");
    if (!e.supported()) return setPhase("unsupported");
    setPhase((p) => (p === "ready" ? p : "checking"));
    const r = await a.load();
    if (my !== seq.current || !same(w)) return;
    if (r.status === 401 || r.status === 403) {
      prep.current = null;
      setData(null);
      setError(r.status === 401 ? COPY.session : COPY.forbidden);
      return setPhase("forbidden");
    }
    const v = r.status === 200 ? parsePushView(r.body) : null;
    if (!v) {
      setError(COPY.loadFailed);
      return setPhase("error");
    }
    setData(v);
    if (!v.available || !v.public_key) return setPhase("unavailable");
    if (!pushSaved) return setPhase("needPreference");
    const bytes = keyBytes(v.public_key);
    if (!bytes) return setPhase("unavailable");
    const reg = await e.registration().catch(() => null);
    const ready = await checkReady(reg, readyTimeoutMs);
    if (my !== seq.current || !same(w)) return;
    if (!reg || !ready) {
      prep.current = null;
      return setPhase("notReady");
    }
    const existing = await reg.pushManager.getSubscription().catch(() => null);
    if (my !== seq.current || !same(w)) return;
    const matches = existing ? sameKey(existing, bytes) : false;
    prep.current = { reg, bytes, existing, matches };
    setNeedsReset(Boolean(existing) && !matches);
    setPhase("ready");
  };
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** After an error, a lost reply or a 409: re-read only. */
  const reread = async () => {
    await load(true);
    if (alive.current) setNotice(COPY.reread);
  };

  // Click handler: NO await before pushManager.subscribe (user gesture).
  const activate = () => {
    const p = prep.current;
    if (!p || busy || !data || needsReset) return;
    if (deps.current.env.permission() === "denied") return setError(COPY.denied);
    const w = who();
    let pending: Promise<PushSub>;
    try {
      pending = p.existing && p.matches ? Promise.resolve(p.existing) : p.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: p.bytes });
    } catch {
      pending = Promise.reject(new Error("subscribe"));
    }
    setBusy(true);
    setError("");
    setNotice("");
    void (async () => {
      let sub: PushSub;
      try {
        sub = await pending;
      } catch {
        if (alive.current) {
          setBusy(false);
          setError(deps.current.env.permission() === "granted" ? COPY.loadFailed : COPY.refused);
        }
        return;
      }
      // Identity fence, after permission and before the POST.
      if (!same(w)) return;
      const body = subscriptionBody(sub);
      if (!body) {
        setBusy(false);
        return void reread();
      }
      const r = await deps.current.api.command({ action: "register", expected_version: data.enrollment?.version ?? 0, consent: true, subscription: body });
      if (!same(w)) return; // reply after an identity change / unmount: ignored
      setBusy(false);
      if (r.status === 401 || r.status === 403) {
        prep.current = null;
        setData(null);
        setError(r.status === 401 ? COPY.session : COPY.forbidden);
        return setPhase("forbidden");
      }
      const v = r.status === 200 ? parsePushView(r.body) : null;
      if (v && v.enrollment?.opted_in && v.enrollment.browser === "current") {
        setData(v);
        prep.current = { ...p, existing: sub, matches: true };
        return setNotice(COPY.activated);
      }
      void reread(); // 409, lost reply, unconfirmed answer
    })();
  };
  const remove = async () => {
    const p = prep.current;
    if (busy || !data?.enrollment) return;
    const w = who();
    setBusy(true);
    setError("");
    setNotice("");
    const r = await deps.current.api.command({ action: "remove", expected_version: data.enrollment.version });
    if (!same(w)) return;
    setBusy(false);
    if (r.status === 401 || r.status === 403) {
      setData(null);
      setError(r.status === 401 ? COPY.session : COPY.forbidden);
      return setPhase("forbidden");
    }
    const v = r.status === 200 ? parsePushView(r.body) : null;
    // E71: the server clears the browser and may keep the general consent (opted_in true +
    // browser none): this browser is removed either way.
    if (v && (!v.enrollment?.opted_in || v.enrollment.browser === "none")) {
      setData(v);
      setNotice(COPY.removed);
      // Best effort: this browser no longer needs its subscription.
      if (p?.existing) {
        await p.existing.unsubscribe().catch(() => false);
        if (alive.current) prep.current = { ...p, existing: null, matches: false };
      }
      return;
    }
    void reread();
  };
  /** Explicit click: drop a subscription made with another key, then prepare again. */
  const reset = async () => {
    const p = prep.current;
    if (busy || !p?.existing) return;
    setBusy(true);
    await p.existing.unsubscribe().catch(() => false);
    if (!alive.current) return;
    setBusy(false);
    await load();
  };

  const tag = pushTag(data, phase);
  const onTagRef = useRef(onTag);
  onTagRef.current = onTag;
  useEffect(() => {
    onTagRef.current?.(tag);
  }, [tag]);
  useEffect(() => () => onTagRef.current?.(null), []);
  const e = data?.enrollment ?? null;
  const status = e?.opted_in ? (e.browser === "current" ? COPY.current : e.browser === "other" ? COPY.other : COPY.off) : COPY.off;
  return (
    <div className={styles.panel} data-web-push={phase} aria-busy={busy || phase === "checking" || undefined}>
      <strong>{COPY.title}</strong>
      <p className={styles.hint}>{COPY.intro}</p>
      {phase === "checking" && <p className={styles.hint} role="status">{COPY.checking}</p>}
      {phase === "unsupported" && <p className={styles.note}>{COPY.unsupported}</p>}
      {phase === "unavailable" && <p className={styles.note}>{COPY.unavailable}</p>}
      {phase === "forbidden" && <p className={styles.note} role="alert">{error}</p>}
      {phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{error}</p>
          <button type="button" className={styles.secondary} onClick={() => void load()}>Réessayer</button>
        </div>
      )}
      {(phase === "needPreference" || phase === "notReady" || phase === "ready") && data && (
        <p className={styles.line} data-web-push-status={e?.opted_in ? e.browser : "off"}>{status}</p>
      )}
      {phase === "needPreference" && <p className={styles.note}>{COPY.savePreferenceFirst}</p>}
      {phase === "notReady" && (
        <div className={styles.note}>
          <p>{COPY.notReady}</p>
          <button type="button" className={styles.secondary} onClick={() => void load()}>Vérifier à nouveau</button>
        </div>
      )}
      {phase === "ready" && data && (
        <div className={styles.actions}>
          {needsReset ? (
            <>
              <p className={styles.hint}>{COPY.resetNote}</p>
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => void reset()} data-web-push-reset="">{COPY.reset}</button>
            </>
          ) : e?.opted_in && e.browser === "current" ? (
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void remove()} data-web-push-remove="">{COPY.disable}</button>
          ) : (
            <button type="button" className={styles.primary} disabled={busy} onClick={activate} data-web-push-activate="">
              {e?.opted_in && e.browser === "other" ? COPY.replace : COPY.activate}
            </button>
          )}
        </div>
      )}
      {busy && <p className={styles.hint} role="status">{COPY.sending}</p>}
      {phase !== "error" && phase !== "forbidden" && error && <p className={styles.error} role="alert" data-web-push-error="">{error}</p>}
      {notice && <p className={notice === COPY.reread ? styles.hint : styles.ok} role="status" data-web-push-notice="">{notice}</p>}
    </div>
  );
}
