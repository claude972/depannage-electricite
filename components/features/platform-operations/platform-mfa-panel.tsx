"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "../../../lib/supabase/client";
import { PLATFORM_MFA_MESSAGE } from "../../../shared/platform-mfa";
import { Field } from "./shared";
import styles from "./platform-operations.module.css";

type Factor = { id: string; label: string };
type Enrollment = { id: string; qr: string; secret: string };

export function PlatformMfaPanel({ userId, onVerified }: { userId: string; onVerified: () => void }) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const processing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [selected, setSelected] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    mounted.current = true;
    title.current?.focus();
    return () => { mounted.current = false; };
  }, []);

  async function run(work: (auth: ReturnType<typeof createClient>["auth"], user: User) => Promise<void>, failure: string) {
    if (processing.current) return;
    processing.current = true;
    setBusy(true);
    setProblem("");
    try {
      const { auth } = createClient();
      const { data, error } = await auth.getUser();
      if (!mounted.current) return;
      if (error || !userId || data.user?.id !== userId) {
        setProblem("La session a changé ou n’est plus vérifiable. Reconnectez-vous à votre compte.");
        return;
      }
      await work(auth, data.user);
    } catch {
      if (mounted.current) setProblem(failure);
    } finally {
      processing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const open = () => run(async (_auth, user) => {
    const available = (user.factors ?? [])
      .filter((factor) => factor.factor_type === "totp" && factor.status === "verified")
      .map((factor, index) => ({ id: factor.id, label: factor.friendly_name || `Application ${index + 1}` }));
    setFactors(available);
    setSelected(available[0]?.id ?? "");
  }, "Impossible de consulter vos moyens de vérification. Réessayez.");

  const enroll = () => run(async (auth) => {
    const { data, error } = await auth.mfa.enroll({ factorType: "totp", issuer: "DomDépannage" });
    if (error || !data?.id || !data.totp.qr_code.startsWith("data:image/svg+xml;") || !data.totp.secret)
      throw new Error("Inscription TOTP indisponible.");
    if (mounted.current) setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }, "Impossible de configurer la vérification à deux étapes pour ce compte. Réessayez.");

  const verify = () => run(async (auth) => {
    const factorId = enrollment?.id ?? selected;
    if (!factorId || !/^\d{6}$/.test(code)) return;
    const { error } = await auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new Error("Code non vérifié.");
    const session = await auth.getClaims();
    if (session.error || session.data?.claims.sub !== userId || session.data?.claims.aal !== "aal2")
      throw new Error("Session non vérifiée.");
    if (mounted.current) {
      setEnrollment(null);
      setCode("");
      onVerified();
    }
  }, "Code non vérifié ou expiré. Saisissez le code actuel de votre application, puis réessayez.");

  const verifying = enrollment !== null || Boolean(selected);
  return (
    <section className={styles.panel} aria-labelledby={titleId} data-platform-mfa="">
      <h3 ref={title} tabIndex={-1} id={titleId}>Vérification à deux étapes</h3>
      <p>{PLATFORM_MFA_MESSAGE}</p>
      {problem && <p className={styles.error} role="alert">{problem}</p>}
      {!factors && <div className={styles.actions}><button type="button" className={styles.button} onClick={() => void open()} disabled={busy}>Commencer la vérification</button></div>}
      {factors?.length === 0 && !enrollment && <>
        <p>Ajoutez une application d’authentification à ce compte pour recevoir des codes sur votre appareil.</p>
        <div className={styles.actions}><button type="button" className={styles.button} onClick={() => void enroll()} disabled={busy}>Configurer mon application</button></div>
      </>}
      {enrollment && <div className={styles.details}>
        <p>Scannez le QR code avec votre application d’authentification, ou saisissez-y la clé de configuration.</p>
        {/* The provider returns a data URL. The QR code and key stay in this panel's memory. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrollment.qr} width={180} height={180} alt="QR code de configuration de l’application d’authentification" />
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => setShowSecret(!showSecret)}>{showSecret ? "Masquer la clé" : "Afficher la clé"}</button>
        </div>
        {showSecret && <code className={styles.mono}>{enrollment.secret}</code>}
      </div>}
      {verifying && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void verify(); }}>
        {factors && factors.length > 1 && <Field label="Application d’authentification" full>
          <select disabled={busy} value={selected} onChange={(event) => { setSelected(event.target.value); setCode(""); }}>
            {factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.label}</option>)}
          </select>
        </Field>}
        <Field label="Code à six chiffres" full>
          <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} disabled={busy} />
        </Field>
        <div className={`${styles.actions} ${styles.full}`}>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy || !/^\d{6}$/.test(code)}>Vérifier le code</button>
        </div>
      </form>}
    </section>
  );
}
