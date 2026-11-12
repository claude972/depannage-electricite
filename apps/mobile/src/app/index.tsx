import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';
import { deviceDrafts } from '@/lib/device-drafts';
import { paymentReturn, paymentReturnKey, recentPaymentReturn } from '@/lib/payment-return';
import { confirmedAccountEmail } from '@/lib/email-account';
import { hasEmailBooking } from '@/lib/email-booking-draft';

export default function Entry() {
  const { session, phoneResume, loginResume } = useSession();
  const actor = session?.user.id;
  const email = confirmedAccountEmail(session?.user);
  const [pending, setPending] = useState<{ actor: string; email: string | undefined; dossier: string | null; booking: boolean } | null>(null);
  useEffect(() => {
    if (!actor) return;
    let live = true;
    void Promise.all([
      deviceDrafts.read(paymentReturnKey(actor), paymentReturn).catch(() => null),
      email ? hasEmailBooking(email, actor).catch(() => false) : false,
    ]).then(([value, booking]) => {
      if (live) setPending({ actor, email, dossier: value && recentPaymentReturn(value.startedAt) ? value.dossier : null, booking });
    });
    return () => { live = false; };
  }, [actor, email]);
  if (session && phoneResume === 'booking') return <Redirect href="/demande-client" />;
  if (actor && (pending?.actor !== actor || pending.email !== email)) return null;
  if (pending?.actor === actor && pending?.dossier)
    return <Redirect href={{ pathname:'/dossier/[id]', params:{ id:pending.dossier, retourPaiement:'1' } }} />;
  if (session && pending?.booking && loginResume !== 'interventions')
    return <Redirect href={{ pathname: '/demande-client', params: { reprise: 'email' } }} />;
  if (session && loginResume === 'interventions') return <Redirect href="/(espace)/interventions" />;
  if (session && (loginResume === 'profile' || loginResume === 'booking')) return <Redirect href="/(espace)/profil" />;
  return <Redirect href={session ? '/(espace)/accueil' : '/bienvenue'} />;
}
