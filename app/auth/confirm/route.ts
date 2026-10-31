import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase/server';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (tokenHash && type && ['signup', 'email', 'recovery'].includes(type)) {
    try {
      const db = await serverClient();
      const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
      if (!error) return NextResponse.redirect(new URL(type === 'recovery' ? '/auth/reset-password?verified=1' : '/?auth=confirmed', url.origin));
    } catch { /* Redirect to a recoverable error, never treat an invalid token as success. */ }
  }
  return NextResponse.redirect(new URL('/?auth=expired', url.origin));
}
