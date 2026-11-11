import 'react-native-url-polyfill/auto';
import { createClient, processLock, type Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { apiOrigin, configured, publishableKey, supabaseOrigin } from './config';
import { secureStorage } from './secure-storage';
import { verifiedPhone, verifyNativePhoneCode, type PhonePurpose } from './phone-client';
import { clientInterventionSnapshot } from '../../../../lib/features/client-interventions/contract';
import { orderReference, parseOrderReference } from '../../../../shared/order-reference';

const supabase = configured ? createClient(supabaseOrigin!, publishableKey!, {
  auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, lock: processLock },
}) : null;
const auth = supabase?.auth;

type LoginDestination = 'profile' | 'interventions';
type SignupValues = { email: string; password: string; firstName: string; lastName: string };

type SessionContext = {
  session: Session | null;
  ready: boolean;
  error: string | null;
  signIn(email: string, password: string, destination?: LoginDestination): Promise<void>;
  signUp(values: SignupValues, destination?: LoginDestination): Promise<boolean>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  loginResume: LoginDestination | null;
  consumeLoginResume(): void;
  verifyPhone(phone: string, code: string, purpose: PhonePurpose): Promise<void>;
  addEmailAccount(email: string, password: string): Promise<void>;
  phoneResume: PhonePurpose | null;
  consumePhoneResume(): void;
};

const Context = createContext<SessionContext | null>(null);

async function signIn(email: string, password: string) {
  if (!auth) throw new Error('L’environnement mobile n’est pas configuré.');
  const { error } = await auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.code === 'email_not_confirmed'
    ? 'Confirmez votre adresse e-mail avant de vous connecter.'
    : error.status === 400 ? 'Identifiants incorrects.' : 'Connexion indisponible. Réessayez.');
}

async function resetPassword(email: string) {
  if (!auth || !apiOrigin) throw new Error('L’environnement mobile n’est pas configuré.');
  const { error } = await auth.resetPasswordForEmail(email.trim(), { redirectTo: apiOrigin + '/auth/reset-password' });
  if (error?.status === 429) throw new Error('Patientez avant de demander un nouveau lien.');
  if (error) throw new Error('La demande de récupération n’a pas pu être envoyée. Réessayez.');
}

async function signOut() {
  if (!auth) return;
  const { error } = await auth.signOut({ scope: 'local' });
  if (error) throw new Error('La déconnexion n’a pas pu être confirmée. Réessayez.');
}

export async function findMyOrders(input: string, signal: AbortSignal) {
  const reference = parseOrderReference(input);
  if (!reference) throw new Error('Saisissez un numéro de commande, par exemple INT-1A2B3C.');
  if (!supabase) throw new Error('L’environnement mobile n’est pas configuré.');
  // The same invoker RPC as the Web search limits results to auth.uid() and the client role.
  const { data, error } = await supabase.rpc('client_intervention_search', {
    p_filter: 'all', p_search: reference, p_after_at: null, p_after_id: null,
  }).abortSignal(signal);
  if (error) throw new Error('La recherche est indisponible. Réessayez.');
  const snapshot = clientInterventionSnapshot.safeParse(data);
  if (!snapshot.success) throw new Error('La réponse du service est incomplète. Réessayez.');
  return snapshot.data.items.filter(order => orderReference(order.id) === reference);
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!auth);
  const [error, setError] = useState<string | null>(null);
  const [phoneResume, setPhoneResume] = useState<PhonePurpose | null>(null);
  const [loginResume, setLoginResume] = useState<LoginDestination | null>(null);

  async function connect(email: string, password: string, destination: LoginDestination = 'profile') {
    setLoginResume(destination);
    try { await signIn(email, password); }
    catch (issue) { setLoginResume(null); throw issue; }
  }

  async function signUp(values: SignupValues, destination: LoginDestination = 'profile') {
    if (!auth || !apiOrigin) throw new Error('L’environnement mobile n’est pas configuré.');
    setLoginResume(destination);
    try {
      const { data, error: issue } = await auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: {
          data: { first_name: values.firstName, last_name: values.lastName,
            full_name: `${values.firstName} ${values.lastName}`, role: 'client' },
          emailRedirectTo: apiOrigin + '/auth/confirm',
        },
      });
      if (issue?.status === 429) throw new Error('Patientez avant de demander une nouvelle inscription.');
      if (issue) throw new Error('L’inscription par e-mail est indisponible. Vérifiez votre adresse ou réessayez.');
      if (data.session) return true;
      setLoginResume(null);
      return false;
    } catch (issue) {
      setLoginResume(null);
      throw issue;
    }
  }

  async function verifyPhone(phone: string, code: string, purpose: PhonePurpose) {
    if (!auth) throw new Error('L’environnement mobile n’est pas configuré.');
    if ((await auth.getSession()).data.session) throw new Error('Déconnectez-vous avant de vérifier un autre numéro.');
    const verified = await verifyNativePhoneCode(phone, code);
    if ((await auth.getSession()).data.session) throw new Error('La session a changé. Reprenez depuis votre espace.');
    setPhoneResume(purpose);
    const { data, error: issue } = await auth.setSession(verified);
    if (issue || !data.session || verifiedPhone(data.user ?? undefined) !== phone) {
      setPhoneResume(null);
      if (data.session) await auth.signOut({ scope: 'local' });
      throw new Error('La session téléphone n’a pas pu être confirmée.');
    }
  }

  async function addEmailAccount(email: string, password: string) {
    if (!auth || !apiOrigin || !session || !verifiedPhone(session.user) || session.user.email)
      throw new Error('Identifiez-vous par téléphone pour créer un accès par e-mail.');
    const { data, error: issue } = await auth.updateUser(
      { email, password }, { emailRedirectTo: apiOrigin + '/auth/confirm' },
    );
    if (issue?.code === 'email_exists' || issue?.code === 'user_already_exists')
      throw new Error('Cette adresse e-mail est déjà utilisée.');
    if (issue || data.user?.id !== session.user.id || verifiedPhone(data.user) !== verifiedPhone(session.user))
      throw new Error('La création de l’accès par e-mail n’a pas pu être confirmée.');
    const requested = data.user.new_email || data.user.email;
    if (requested?.toLowerCase() !== email.toLowerCase())
      throw new Error('La demande de confirmation de l’adresse e-mail n’a pas pu être vérifiée.');
  }

  useEffect(() => {
    if (!auth) return;
    const client = auth;
    let live = true;
    let changed = false;
    const { data } = client.onAuthStateChange((event, value) => {
      if (!live || event === 'INITIAL_SESSION') return;
      changed = true;
      setSession(value);
      if (!value) {
        setPhoneResume(null);
        setLoginResume(null);
      }
      setError(null);
      setReady(true);
    });
    const transition = AppState.addEventListener('change', state => {
      if (state === 'active') void client.startAutoRefresh();
      else void client.stopAutoRefresh();
    });
    void client.getSession().then(({ data: initial, error: issue }) => {
      if (!live || changed) return;
      setSession(issue ? null : initial.session);
      setError(issue ? 'La session n’a pas pu être restaurée. Reconnectez-vous.' : null);
      setReady(true);
    }).catch(() => {
      if (!live || changed) return;
      setError('Le stockage sécurisé est indisponible.');
      setReady(true);
    });
    if (AppState.currentState === 'active') void client.startAutoRefresh();
    return () => {
      live = false;
      data.subscription.unsubscribe();
      transition.remove();
      void client.stopAutoRefresh();
    };
  }, []);
  return <Context.Provider value={{
    session, ready, error, signIn: connect, signUp, signOut, resetPassword, verifyPhone, addEmailAccount,
    loginResume, consumeLoginResume: () => setLoginResume(null),
    phoneResume, consumePhoneResume: () => setPhoneResume(null),
  }}>{children}</Context.Provider>;
}

export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionProvider requis.');
  return value;
}
