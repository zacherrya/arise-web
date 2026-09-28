(function(root){
  "use strict";
  const CONFIG_KEY="arise.cloud.config.v1",SESSION_KEY="arise.cloud.session.v1",GOOGLE_PKCE_KEY="arise.cloud.google.pkce.v1";
  const cleanBase=value=>String(value||"").trim().replace(/\/+$/,"");
  const validBase=value=>/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cleanBase(value));
  function create(options={}){
    const storage=options.storage||localStorage,transient=options.sessionStorage||root.sessionStorage||storage,fetcher=options.fetch||fetch,clock=options.clock||(()=>Date.now()),cryptoApi=options.crypto||root.crypto;
    let config=JSON.parse(storage.getItem(CONFIG_KEY)||"null")||options.config||root.ARISECloudConfig||null,session=JSON.parse(storage.getItem(SESSION_KEY)||"null");
    if(config&&validBase(config.url)&&String(config.publishableKey||"").length>=20)storage.setItem(CONFIG_KEY,JSON.stringify(config));
    const headers=auth=>({apikey:config.publishableKey,"Content-Type":"application/json",...(auth&&session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{})});
    function rememberSession(next){session=next;storage.setItem(SESSION_KEY,JSON.stringify(session));return session}
    async function refreshSession(){if(!session?.refresh_token){const error=Error("Your ARISE session expired. Sign in again.");error.authInvalid=true;throw error}const response=await fetcher(config.url+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:headers(false),body:JSON.stringify({refresh_token:session.refresh_token})}),body=await response.text(),data=body?JSON.parse(body):null;if(!response.ok){const error=Error(data?.message||data?.error_description||"Your ARISE session expired. Sign in again.");error.authInvalid=response.status===400||response.status===401||response.status===403;throw error}return rememberSession(data)}
    async function request(path,init={},retried=false){if(!config||!validBase(config.url))throw Error("Supabase is not configured.");const response=await fetcher(config.url+path,{...init,headers:{...headers(init.auth!==false),...(init.headers||{})}});const body=await response.text(),data=body?JSON.parse(body):null;const detail=String(data?.message||data?.msg||data?.error_description||"");const expired=(response.status===401||response.status===403&&/invalid jwt|jwt expired|token.*expired|invalid claims/i.test(detail))&&init.auth!==false;if(expired&&!retried){await refreshSession();return request(path,init,true)}if(!response.ok){const error=Error(detail||`Supabase request failed (${response.status}).`);error.authInvalid=expired;error.code=data?.code||null;error.syncConflict=error.code==="40001"||/ARISE_SYNC_CONFLICT/.test(detail);throw error}return data}
    function configure(url,publishableKey){url=cleanBase(url);publishableKey=String(publishableKey||"").trim();if(!validBase(url)||publishableKey.length<20)throw Error("Enter a valid Supabase project URL and publishable key.");config={url,publishableKey};storage.setItem(CONFIG_KEY,JSON.stringify(config));return config}
    async function signIn(email,password){const data=await request("/auth/v1/token?grant_type=password",{auth:false,method:"POST",body:JSON.stringify({email:String(email||"").trim(),password})});rememberSession(data);return data.user}
    async function signUp(email,password){const data=await request("/auth/v1/signup",{auth:false,method:"POST",body:JSON.stringify({email:String(email||"").trim(),password})});if(data?.access_token)rememberSession(data);return data}
    async function resendConfirmation(email){email=String(email||"").trim();if(!email)throw Error("Enter the email you used for ARISE.");return request("/auth/v1/resend",{auth:false,method:"POST",body:JSON.stringify({type:"signup",email})})}
    async function restoreSession(){if(!session?.access_token)return false;try{const user=await request("/auth/v1/user");rememberSession({...session,user});return true}catch(error){if(error.authInvalid){signOut();return false}throw error}}
    function randomUrlSafe(length=32){if(!cryptoApi?.getRandomValues)throw Error("Secure sign-in is unavailable in this browser.");const bytes=new Uint8Array(length);cryptoApi.getRandomValues(bytes);return Array.from(bytes,b=>"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"[b%66]).join("")}
    async function googleAuthorizationUrl(redirectUrl){
      if(!config||!validBase(config.url))throw Error("Cloud sync is not configured.");
      if(!cryptoApi?.subtle?.digest)throw Error("Secure sign-in needs HTTPS or localhost.");
      const verifier=randomUrlSafe(64),digest=await cryptoApi.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
      const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
      transient.setItem(GOOGLE_PKCE_KEY,JSON.stringify({verifier,createdAt:clock()}));
      const params=new URLSearchParams({provider:"google",redirect_to:redirectUrl,code_challenge:challenge,code_challenge_method:"s256"});
      return {url:config.url+"/auth/v1/authorize?"+params.toString(),challenge};
    }
    async function completeGoogleSignIn(code){
      const pending=JSON.parse(transient.getItem(GOOGLE_PKCE_KEY)||"null");
      if(!pending?.verifier||clock()-pending.createdAt>5*60*1000)throw Error("Google sign-in expired. Please try again.");
      const data=await request("/auth/v1/token?grant_type=pkce",{auth:false,method:"POST",body:JSON.stringify({auth_code:code,code_verifier:pending.verifier})});
      transient.removeItem(GOOGLE_PKCE_KEY);rememberSession(data);return data.user;
    }
    function signOut(){session=null;storage.removeItem(SESSION_KEY);transient.removeItem(GOOGLE_PKCE_KEY)}
    async function readState(){
      const userId=session?.user?.id;if(!userId)throw Error("Sign in before syncing.");
      const rows=await request(`/rest/v1/arise_state?user_id=eq.${encodeURIComponent(userId)}&select=revision,data,device_id,updated_at&limit=1`,{headers:{Accept:"application/json"}});
      if(!Array.isArray(rows))throw Error("Supabase returned an invalid ARISE state.");
      return rows[0]||null;
    }
    async function pushState(expectedRevision,data,deviceId){
      if(!session?.user?.id)throw Error("Sign in before syncing.");
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error("Invalid cloud revision.");
      if(!data||typeof data!=="object"||Array.isArray(data)||!Array.isArray(data.projects))throw Error("Invalid ARISE data for sync.");
      const row=await request("/rest/v1/rpc/push_arise_state",{method:"POST",body:JSON.stringify({expected_revision:expectedRevision,new_data:data,new_device_id:String(deviceId||"").slice(0,120)})});
      if(!row||typeof row.revision!=="number"||row.user_id!==session.user.id)throw Error("Supabase did not confirm the account's write.");
      return row;
    }
    return {configure,signIn,signUp,resendConfirmation,restoreSession,googleAuthorizationUrl,completeGoogleSignIn,signOut,readState,pushState,status:()=>({configured:!!config,url:config?.url||null,signedIn:!!session,userId:session?.user?.id||null,email:session?.user?.email||null}),keys:{CONFIG_KEY,SESSION_KEY,GOOGLE_PKCE_KEY}};
  }
  root.ARISECloud={create,validBase};
})(typeof window!=="undefined"?window:globalThis);
