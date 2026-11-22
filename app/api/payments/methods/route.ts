import { authenticatedClient, adminClient } from '@/lib/supabase/server';
import { stripeClient } from '@/lib/supabase/stripe';
import { createSavedMethodHandlers } from '@/lib/features/saved-payment-methods/handlers';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handlers=createSavedMethodHandlers({authenticate:async()=>{const {db,user}=await authenticatedClient();return {db,userId:user.id}},admin:adminClient,stripe:stripeClient,env:()=>process.env});
export const GET=handlers.GET;
export const POST=handlers.POST;
