import{authenticatedClient,adminClient}from'@/lib/supabase/server';
import{stripeClient}from'@/lib/supabase/stripe';
import{createFeeProofHandlers}from'./fee-handlers';
export const feeProofHandlers=createFeeProofHandlers({authenticate:async()=>{const{db,user}=await authenticatedClient();return{db,userId:user.id}},admin:adminClient,stripe:stripeClient,env:()=>process.env});
