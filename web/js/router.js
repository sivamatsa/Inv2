/* Minimal hash router - no framework. Each view module registers a render
   function; the router shows/hides panes and calls render on navigation. */
window.App = window.App || {};

App.router = (function () {
  const views = {};
  let current = null;

  function register(name, renderFn) {
    views[name] = renderFn;
  }

  function currentName() {
    return (location.hash || '#dashboard').slice(1).split('?')[0];
  }

  async function show(name) {
    if (!views[name]) name = 'dashboard';
    App.utils.qsa('.view-pane').forEach((p) => p.classList.toggle('active', p.dataset.view === name));
    App.utils.qsa('.nav-link').forEach((l) => l.classList.toggle('active', l.dataset.nav === name));
    const titleEl = App.utils.qs('#topbarTitle');
    const link = App.utils.qs(`.nav-link[data-nav="${name}"]`);
    if (titleEl && link) titleEl.textContent = link.dataset.label || name;
    current = name;
    try {
      await views[name]();
    } catch (e) {
      console.error('View render failed:', name, e);
      App.utils.toast('Could not load this view: ' + (e.message || e), 'err');
    }
  }

  function navigate(name) {
    if (location.hash.slice(1).split('?')[0] === name) { show(name); return; }
    location.hash = '#' + name;
  }

  function refreshCurrent() {
    if (current) show(current);
  }

  function init() {
    window.addEventListener('hashchange', () => show(currentName()));
    show(currentName());
  }

  return { register, navigate, init, refreshCurrent, currentName: () => current };
})();
