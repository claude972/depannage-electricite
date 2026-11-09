function httpsOrigin(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : null;
  } catch {
    return null;
  }
}

export const apiOrigin = httpsOrigin(process.env.EXPO_PUBLIC_API_URL);
export const supabaseOrigin = httpsOrigin(process.env.EXPO_PUBLIC_SUPABASE_URL);
export const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
export const configured = Boolean(apiOrigin && supabaseOrigin && publishableKey?.startsWith('sb_publishable_'));
