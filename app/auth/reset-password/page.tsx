"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Brand } from "@/components/app/ui";
import { ThemeSurface } from "@/components/app/theme-provider";
import { ThemeToggle } from "@/components/app/theme-toggle";
import styles from "./page.module.css";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const initialization = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    let active = true;
    if (!initialization.current)
      initialization.current = (async () => {
        try {
          const db = createClient();
          const url = new URL(window.location.href);
          const code = url.searchParams.get("code");
          if (code) {
            const result = await db.auth.exchangeCodeForSession(code);
            window.history.replaceState({}, "", url.pathname);
            if (result.error) return false;
          }
          const result = await db.auth.getUser();
          return !result.error && !!result.data.user;
        } catch {
          return false;
        }
      })();
    void initialization.current.then((valid) => {
      if (!active) return;
      setReady(valid);
      if (!valid)
        setError(
          "Ce lien est expiré ou a déjà été utilisé. Demandez un nouveau lien depuis la connexion.",
        );
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !ready) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 10 || password.length > 128) {
      setError("Choisissez un mot de passe de 10 à 128 caractères.");
      return;
    }
    if (password !== form.get("confirmation")) {
      setError("Les deux mots de passe doivent être identiques.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const db = createClient();
      const { error: authError } = await db.auth.updateUser({ password });
      if (authError) throw authError;
      setSuccess(true);
    } catch {
      setError(
        "Le mot de passe n’a pas pu être modifié. Vérifiez les critères du compte ou demandez un nouveau lien.",
      );
    } finally {
      setSaving(false);
    }
  }
  // Visual layer only (FASTSPLIT-AUTH-RESET-THEME-001): same Auth calls, states and texts as before.
  return (
    <ThemeSurface className={styles.page}>
      <header className={styles.bar}>
        <Link className={styles.home} href="/" aria-label="Courant, retour à l’accueil">
          <Brand compact />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className={styles.main}>
        <section className={styles.card} aria-labelledby="reset-title" aria-busy={loading || saving ? true : undefined}>
          <p className={styles.eyebrow}>Dépannage électrique</p>
          <h1 id="reset-title">
            {success ? "Votre mot de passe a été modifié" : "Choisir un nouveau mot de passe"}
          </h1>
          {loading ? (
            <p role="status" className={styles.status}>
              Vérification de votre lien…
            </p>
          ) : success ? (
            <>
              <p className={styles.success} role="status">
                Vous pouvez désormais utiliser votre nouveau mot de passe pour vous connecter.
              </p>
              <div className={styles.actions}>
                <Link className={styles.primary} href="/">
                  Retour à l’application
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className={styles.lead}>Utilisez au moins 10 caractères et un mot de passe différent de vos autres comptes.</p>
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
              {ready ? (
                <form onSubmit={submit} className={styles.form}>
                  <label htmlFor="password">Nouveau mot de passe</label>
                  <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
                  <label htmlFor="confirmation">Confirmer le mot de passe</label>
                  <input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
                  <div className={styles.actions}>
                    <button type="submit" className={styles.primary} disabled={saving}>
                      {saving ? "Enregistrement…" : "Enregistrer le mot de passe"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className={styles.actions}>
                  <Link className={styles.secondary} href="/">
                    Revenir à l’application pour demander un nouveau lien
                  </Link>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </ThemeSurface>
  );
}
