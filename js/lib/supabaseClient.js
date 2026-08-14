/* Supabase connection + auth session management. Mirrors the "paste your
   project URL/anon key" pattern from the reference dashboard, extended to
   be mandatory (this build has no local-only mode - Supabase is the
   authoritative store per spec Section 53). */
window.App = window.App || {};

App.auth = (function () {
  const CONFIG_KEY = 'investmentAppSupabaseConfig';
  let client = null;
  let currentUser = null;
  let currentSession = null;
  let demoMode = false;
  const listeners = [];

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function isConfigured() {
    return !!getConfig();
  }

  function saveConfig(url, anonKey) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, anonKey }));
    client = null;
    return init();
  }

  function clearConfig() {
    localStorage.removeItem(CONFIG_KEY);
    client = null;
    currentUser = null;
    currentSession = null;
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function notify() {
    listeners.forEach((fn) => {
      try { fn(currentUser, currentSession); } catch (e) { console.error(e); }
    });
  }

  function init() {
    const cfg = getConfig();
    if (!cfg || !window.supabase) return null;
    if (client) return client;
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.getSession().then(({ data }) => {
      const session = data && data.session || null;
      // A signIn()/signUp() can complete (via onAuthStateChange, below)
      // before this initial check resolves. Only apply this result if it
      // reports a real session, or if nothing more recent already signed
      // someone in - otherwise a slow, now-stale "no session" answer would
      // clobber a sign-in that has already succeeded.
      if (session || !currentUser) {
        currentSession = session;
        currentUser = session ? session.user : null;
        notify();
      }
    });
    client.auth.onAuthStateChange((_event, session) => {
      currentSession = session || null;
      currentUser = session ? session.user : null;
      notify();
    });
    return client;
  }

  function getClient() {
    return client || init();
  }

  function getUser() {
    return currentUser;
  }

  function isDemoMode() {
    return demoMode;
  }

  // Demo Mode: an in-browser sample-data sandbox (js/lib/demoData.js) so the
  // whole app can be explored with zero setup. Deliberately bypasses
  // getConfig()/localStorage entirely - it neither reads nor overwrites a
  // real saved Supabase connection, so switching back to a real project
  // afterward (exitDemoMode) picks up exactly where that was left.
  function enterDemoMode() {
    demoMode = true;
    client = App.demo.createClient();
    App.demo.seed();
    currentUser = App.demo.DEMO_USER;
    currentSession = { user: currentUser };
    notify();
  }

  function exitDemoMode() {
    demoMode = false;
    client = null;
    currentUser = null;
    currentSession = null;
    notify();
  }

  async function signUp(email, password, fullName) {
    const c = getClient();
    if (!c) throw new Error('Supabase is not configured yet.');
    const { data, error } = await c.auth.signUp({
      email, password, options: { data: { full_name: fullName || email } },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const c = getClient();
    if (!c) throw new Error('Supabase is not configured yet.');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (demoMode) { exitDemoMode(); return; }
    const c = getClient();
    if (!c) return;
    await c.auth.signOut();
    currentUser = null;
    currentSession = null;
  }

  return {
    isConfigured, saveConfig, clearConfig, getConfig, init, getClient, getUser, onChange,
    signUp, signIn, signOut, isDemoMode, enterDemoMode, exitDemoMode,
  };
})();
