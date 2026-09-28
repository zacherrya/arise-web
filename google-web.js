/* Google Calendar for the web build.
   Uses Google Identity Services' token client: the user approves access in a
   Google popup and ARISE receives a short-lived (about 1 hour) access token.
   The token is kept in memory only and is never written to storage or synced.
   The only thing stored is a per-account "linked" flag, so ARISE knows to ask
   Google for a fresh token (normally without a consent screen) next time. */
(function(){
  'use strict';
  const EVENTS_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const SCOPE = "https://www.googleapis.com/auth/calendar.events";
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const FLAG = "arise.google.web.linked.v1:";
  const REAUTH = "Google Calendar needs a quick refresh. Tap Sync calendar.";

  function reauthError(){ const e = new Error(REAUTH); e.code = "reauth"; return e; }

  function create(opts){
    const clientId = opts.clientId;
    const storage = opts.storage || window.localStorage;
    const fetchFn = opts.fetch || ((...a) => window.fetch(...a));
    const doc = opts.document || window.document;
    let token = null, expiresAt = 0, tokenClient = null, settle = null, loading = null, inflight = null;

    const flagKey = () => FLAG + (opts.account() || "local");
    const gis = () => window.google && window.google.accounts && window.google.accounts.oauth2;
    const hasToken = () => !!token && Date.now() < expiresAt;
    const linked = () => storage.getItem(flagKey()) === "1";

    function loadGis(){
      if(gis()) return Promise.resolve();
      if(loading) return loading;
      loading = new Promise((resolve, reject) => {
        const s = doc.createElement("script");
        s.src = GIS_SRC; s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { loading = null; reject(new Error("Couldn't load Google sign-in. Check your connection and try again.")); };
        doc.head.appendChild(s);
      });
      return loading;
    }

    function clientFor(){
      if(!tokenClient){
        tokenClient = gis().initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: resp => settle && settle(resp),
          error_callback: err => settle && settle({ error: (err && err.type) || "popup_failed" }),
        });
      }
      return tokenClient;
    }

    // Must run inside the user's click, before any await, or browsers block the popup.
    function requestToken(){
      if(inflight) return inflight;
      if(!gis()) return loadGis().then(() => { throw new Error("Google sign-in is ready. Tap Connect again."); });
      inflight = new Promise((resolve, reject) => {
        settle = resp => {
          settle = null;
          if(!resp || resp.error){
            const closed = resp && (resp.error === "popup_closed" || resp.error === "access_denied");
            reject(new Error(closed ? "Google Calendar wasn't connected." : "Couldn't open Google sign-in. Allow pop-ups for this site and try again."));
            return;
          }
          if(!gis().hasGrantedAllScopes(resp, SCOPE)){ reject(new Error("ARISE needs calendar access to connect. Tick the calendar box on Google's screen.")); return; }
          token = resp.access_token;
          const life = Number.isFinite(Number(resp.expires_in)) ? Number(resp.expires_in) : 3600;
          expiresAt = Date.now() + Math.max(0, life - 60) * 1000;  // refresh a minute early
          storage.setItem(flagKey(), "1");
          resolve(token);
        };
        clientFor().requestAccessToken({ prompt: linked() ? "" : "consent" });
      });
      inflight.then(() => { inflight = null; }, () => { inflight = null; });
      return inflight;
    }

    async function call(method, url, body, interactive){
      if(!hasToken()){
        if(!interactive) throw reauthError();
        await requestToken();
      }
      const res = await fetchFn(url, {
        method,
        headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      if(res.status === 401){ token = null; expiresAt = 0; throw reauthError(); }
      if(!res.ok){
        let detail = "";
        try{ detail = ((await res.json()).error || {}).message || ""; }catch(e){}
        throw new Error(`Google Calendar error (${res.status})${detail ? ": " + detail : ""}`);
      }
      return res.status === 204 ? null : res.json();
    }

    return {
      preload(){ loadGis().catch(() => {}); },
      linked,
      hasToken,
      connect: requestToken,
      disconnect(){
        const t = token;
        token = null; expiresAt = 0;
        storage.removeItem(flagKey());
        if(t && gis()) gis().revoke(t, () => {});
      },
      listEvents: (args, interactive) => call("GET", `${EVENTS_API}?${new URLSearchParams({ timeMin: args.timeMin, timeMax: args.timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "500" })}`, null, interactive),
      createEvent: (args, interactive) => call("POST", `${EVENTS_API}?conferenceDataVersion=1&sendUpdates=all`, args.event, interactive),
      updateEvent: (args, interactive) => call("PUT", `${EVENTS_API}/${encodeURIComponent(args.eventId)}?conferenceDataVersion=1&sendUpdates=all`, args.event, interactive),
    };
  }

  window.ARISEGoogleWeb = { create, SCOPE };
})();
