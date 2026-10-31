'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './page.module.css';

export default function ResetPasswordPage() {
  const [ready,setReady] = useState(false);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState(false);
  const initialization = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    let active=true;
    if (!initialization.current) initialization.current = (async () => {
      try {
        const db=createClient();
        const url=new URL(window.location.href);
        const code=url.searchParams.get('code');
        if (code) {
          const result=await db.auth.exchangeCodeForSession(code);
          window.history.replaceState({},'',url.pathname);
          if (result.error) return false;
        }
        const result=await db.auth.getUser();
        return !result.error && !!result.data.user;
      } catch { return false; }
    })();
    void initialization.current.then(valid => {
      if (!active) return;
      setReady(valid);
      if (!valid) setError('Ce lien est expiré ou a déjà été utilisé. Demandez un nouveau lien depuis la connexion.');
      setLoading(false);
    });
    return () => { active=false; };
  },[]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(saving || !ready) return;
    const form=new FormData(event.currentTarget);
    const password=String(form.get('password') ?? '');
    if(password.length<10 || password.length>128) { setError('Choisissez un mot de passe de 10 à 128 caractères.'); return; }
    if(password!==form.get('confirmation')) { setError('Les deux mots de passe doivent être identiques.'); return; }
    setSaving(true);setError('');
    try {
      const db=createClient();
      const {error:authError}=await db.auth.updateUser({password});
      if(authError) throw authError;
      setSuccess(true);
    } catch { setError('Le mot de passe n’a pas pu être modifié. Vérifiez les critères du compte ou demandez un nouveau lien.'); }
    finally {setSaving(false);}
  }
  return <main className={styles.screen}><section className={styles.panel} aria-labelledby="reset-title">
    <Link href="/" className={styles.brand}>Courant<span>Dépannage électrique</span></Link>
    <h1 id="reset-title">{success?'Votre mot de passe a été modifié':'Choisir un nouveau mot de passe'}</h1>
    {loading?<p role="status">Vérification de votre lien…</p>:success?<><p>Vous pouvez désormais utiliser votre nouveau mot de passe pour vous connecter.</p><Link className={styles.button} href="/">Retour à l’application</Link></>:<>
      <p>Utilisez au moins 10 caractères et un mot de passe différent de vos autres comptes.</p>
      {error?<p className={styles.error} role="alert">{error}</p>:null}
      {ready?<form onSubmit={submit}>
        <label htmlFor="password">Nouveau mot de passe</label><input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128}/>
        <label htmlFor="confirmation">Confirmer le mot de passe</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={10} maxLength={128}/>
        <button type="submit" disabled={saving}>{saving?'Enregistrement…':'Enregistrer le mot de passe'}</button>
      </form>:<Link href="/">Revenir à l’application pour demander un nouveau lien</Link>}
    </>}
  </section></main>;
}
