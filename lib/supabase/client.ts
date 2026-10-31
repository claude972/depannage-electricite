import { createBrowserClient } from '@supabase/ssr';
// Official SSR pattern: https://supabase.com/docs/guides/auth/server-side/creating-a-client
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('La connexion aux comptes est en cours de configuration.');
  return createBrowserClient(url, key);
}
