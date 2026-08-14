/* Shared formatting/parsing helpers, plain global namespace (no bundler, no
   ES modules) so this keeps working when the file is opened directly. */
window.App = window.App || {};

App.utils = (function () {
  const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

  function currencySymbol(code) {
    return CURRENCY_SYMBOLS[code] || (code ? code + ' ' : '₹');
  }

  function fmtMoney(n, currency) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const sym = currencySymbol(currency || (App.state && App.state.profile && App.state.profile.preferred_currency));
    return sym + Math.round(Number(n)).toLocaleString('en-IN');
  }

  function fmtNum(n, dec) {
    if (dec === undefined) dec = 1;
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec });
  }

  function fmtPct(n, dec) {
    if (dec === undefined) dec = 2;
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(dec) + '%';
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : parseDate(d);
    if (!dt) return '—';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return dt.getDate() + ' ' + months[dt.getMonth()] + ' ' + dt.getFullYear();
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '—';
    return fmtDate(dt) + ', ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  function toISO(d) {
    if (!d) return null;
    const dt = (d instanceof Date) ? d : parseDate(d);
    if (!dt) return null;
    const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, '0'), day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function today0() {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function todayISO() {
    return toISO(today0());
  }

  function daysBetween(a, b) {
    const DAY = 86400000;
    const da = (a instanceof Date) ? a : parseDate(a);
    const db = (b instanceof Date) ? b : parseDate(b);
    if (!da || !db) return null;
    return Math.round((db - da) / DAY);
  }

  function parseNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = parseFloat(String(v).replace(/[,₹\s]/g, ''));
    return isNaN(n) ? null : n;
  }

  function excelSerialToDate(n) {
    if (!window.XLSX || !XLSX.SSF) return null;
    const d = XLSX.SSF.parse_date_code(n);
    return d ? new Date(d.y, d.m - 1, d.d) : null;
  }

  function parseDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    if (typeof v === 'number') {
      const d = excelSerialToDate(v);
      if (d) return d;
    }
    const s = String(v).trim();
    if (!s) return null;
    let m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d2 = new Date(s);
    return isNaN(d2) ? null : new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function toast(msg, type) {
    const w = document.getElementById('toastWrap');
    if (!w) return;
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'err' ? 'err' : type === 'info' ? '' : 'ok');
    t.textContent = msg;
    w.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, 3800);
  }

  function statusBadgeClass(status) {
    return 'st-' + String(status || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  return {
    currencySymbol, fmtMoney, fmtNum, fmtPct, fmtDate, fmtDateTime, toISO, today0, todayISO,
    daysBetween, parseNum, parseDate, escapeHtml, debounce, toast, statusBadgeClass, qs, qsa, el,
  };
})();
