import{authenticatedClient,adminClient}from'@/lib/supabase/server';import{stripeClient}from'@/lib/supabase/stripe';import{createPayoutProofHandlers}from'./handlers';
export const payoutProofHandlers=createPayoutProofHandlers({authenticate:async()=>{const{db,user}=await authenticatedClient();return{db,userId:user.id}},admin:adminClient,stripe:stripeClient,env:()=>process.env});
