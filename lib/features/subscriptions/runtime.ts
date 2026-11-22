import {authenticatedClient,adminClient} from '@/lib/supabase/server';
import {stripeClient} from '@/lib/supabase/stripe';
import {createSubscriptionHandlers} from './handlers';
export const subscriptionHandlers=createSubscriptionHandlers({authenticate:async()=>{const {db,user}=await authenticatedClient();return {db,userId:user.id}},admin:adminClient,stripe:stripeClient,env:()=>process.env});
