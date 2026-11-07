// Pure availability: absent choices never become a financial policy. No secrets returned.
export function refundPolicy(values:Record<string,string|undefined>){
 const key=values.STRIPE_SECRET_KEY??'',v=values.PLATFORM_REFUND_POLICY_VERSION,a=values.PLATFORM_REFUND_REVERSE_TRANSFER,b=values.PLATFORM_REFUND_APPLICATION_FEE;
 if(!/^(sk|rk)_(test|live)_/.test(key)||(/^(sk|rk)_live_/.test(key)&&values.STRIPE_LIVE_PAYMENTS_ENABLED!=='true')||!v||!/^[A-Za-z0-9_.-]{1,80}$/.test(v)||!['true','false'].includes(a??'')||!['true','false'].includes(b??'')||(b==='true'&&a!=='true'))return null;
 return{version:v,reverse_transfer:a==='true',refund_application_fee:b==='true',livemode:/^(sk|rk)_live_/.test(key)};
}
