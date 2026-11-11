import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';
import { deviceDrafts } from '@/lib/device-drafts';
import { paymentReturn, paymentReturnKey, recentPaymentReturn } from '@/lib/payment-return';

export default function Entry() {
  const { session, phoneResume, loginResume } = useSession();
  const actor = session?.user.id;
  const [pending, setPending] = useState<{ actor: string; dossier: string | null } | null>(null);
  useEffect(() => {
    if (!actor) return;
    let live = true;
    void deviceDrafts.read(paymentReturnKey(actor), paymentReturn).then(value => {
      if (live) setPending({ actor, dossier: value && recentPaymentReturn(value.startedAt) ? value.dossier : null });
    }, () => { if (live) setPending({ actor, dossier: null }); });
    return () => { live = false; };
  }, [actor]);
  if (session && phoneResume === 'booking') return <Redirect href="/demande-client" />;
  if (session && phoneResume === 'lookup') return <Redirect href="/retrouver" />;
  if (actor && pending?.actor !== actor) return null;
  if (pending?.actor === actor && pending?.dossier)
    return <Redirect href={{ pathname:'/dossier/[id]', params:{ id:pending.dossier, retourPaiement:'1' } }} />;
  if (session && loginResume) return <Redirect href="/(espace)/profil" />;
  return <Redirect href={session ? '/(espace)/accueil' : '/bienvenue'} />;
}
