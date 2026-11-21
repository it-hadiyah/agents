import { h, mount, icon, btn, api, state, can, canAny, toast, errMsg, fld, skeleton, empty } from './lib.js';

const app = document.getElementById('app');
let cleanup = null, navToken = 0, pollTimer = null;

const ROUTES = [
  { path: /^$/, id: 'dashboard', title: 'لوحة التحكم', perm: () => can('dashboard.view'), mod: './pages/dashboard.js' },
  { path: /^members$/, id: 'members', title: 'الأعضاء', perm: () => can('members.view'), mod: './pages/members.js' },
  { path: /^members\/(\d+)$/, id: 'members', title: 'ملف العضو', perm: () => can('members.view'), mod: './pages/profile.js' },
  { path: /^finance$/, id: 'finance', title: 'المالية', perm: () => can('payments.view'), mod: './pages/finance.js' },
  { path: /^notifications$/, id: 'notifications', title: 'مركز التنبيهات', perm: () => can('notifications.view'), mod: './pages/notifications.js' },
  { path: /^reports$/, id: 'reports', title: 'التقارير', perm: () => can('reports.view'), mod: './pages/reports.js' },
  { path: /^import$/, id: 'import', title: 'استيراد الأعضاء', perm: () => can('members.import'), mod: './pages/import.js' },
  { path: /^settings$/, id: 'settings', title: 'الإعدادات', perm: () => canAny('settings.view', 'users.manage'), mod: './pages/settings.js' },
  { path: /^audit$/, id: 'audit', title: 'سجل التدقيق', perm: () => can('audit.view'), mod: './pages/audit.js' },
];
const NAV = [
  { id: 'dashboard', href: '#/', label: 'لوحة التحكم', icon: 'home', group: 'الرئيسية' },
  { id: 'members', href: '#/members', label: 'الأعضاء', icon: 'users', group: 'الرئيسية' },
  { id: 'finance', href: '#/finance', label: 'الاشتراكات والمدفوعات', icon: 'wallet', group: 'الرئيسية' },
  { id: 'notifications', href: '#/notifications', label: 'مركز التنبيهات', icon: 'bell', group: 'المتابعة' },
  { id: 'reports', href: '#/reports', label: 'التقارير', icon: 'chart', group: 'المتابعة' },
  { id: 'import', href: '#/import', label: 'استيراد الأعضاء', icon: 'upload', group: 'المتابعة' },
  { id: 'settings', href: '#/settings', label: 'الإعدادات', icon: 'settings', group: 'الإدارة' },
  { id: 'audit', href: '#/audit', label: 'سجل التدقيق', icon: 'shield', group: 'الإدارة' },
];
const allowed = (id) => ROUTES.find((r) => r.id === id && r.path.source !== '^members\\/(\\d+)$')?.perm();

function applyBrand() {
  const b = state.meta?.org?.brand;
  if (b && /^#[0-9a-f]{6}$/i.test(b)) document.documentElement.style.setProperty('--brand', b);
}
function setTheme(t) { try { localStorage.setItem('theme', t); } catch { /* */ } document.documentElement.dataset.theme = t; }
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

// ───────── تسجيل الدخول ─────────
async function renderLogin(message) {
  let pub = {};
  try { pub = await api('/public/settings'); } catch { /* */ }
  const name = pub['org.name'] || 'جمعية هدية';
  if (/^#[0-9a-f]{6}$/i.test(pub['brand.primary'] || '')) document.documentElement.style.setProperty('--brand', pub['brand.primary']);
  const u = fld({ label: 'اسم المستخدم', name: 'username', required: true, ltr: true, autocomplete: 'username' });
  const p = fld({ label: 'كلمة المرور', name: 'password', type: 'password', required: true, ltr: true, autocomplete: 'current-password' });
  const err = h('div', { role: 'alert' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'تسجيل الدخول');
  const form = h('form', { novalidate: true }, h('h2', {}, 'تسجيل الدخول'), h('p', { class: 'muted' }, 'للمخوّلين بإدارة بيانات الجمعية العمومية فقط.'),
    message ? h('div', { class: 'alert warn' }, icon('alert'), message) : null, err, u.root, p.root, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); mount(err); submit.setAttribute('aria-busy', 'true');
    try {
      await api('/auth/login', { method: 'POST', body: { username: u.input.value.trim(), password: p.input.value } });
      await boot();
    } catch (ex) {
      mount(err, h('div', { class: 'alert bad' }, icon('alert'), errMsg(ex))); p.input.value = ''; p.input.focus();
    } finally { submit.removeAttribute('aria-busy'); }
  });
  document.title = `تسجيل الدخول – ${name}`;
  mount(app, h('main', { class: 'login' },
    h('section', { class: 'login-art' },
      h('div', { class: 'brand', style: { borderColor: 'transparent' } }, pub['org.logo'] ? h('img', { src: '/branding/logo', alt: '' }) : h('div', { class: 'mark' }, name.slice(0, 1)), h('div', {}, h('b', {}, name))),
      h('div', {}, h('h1', {}, 'منصة إدارة أعضاء الجمعية العمومية'), h('p', { style: { marginBlockStart: '12px' } }, 'سجل مركزي للعضويات والاشتراكات والتجديد، بأرقام تُحسب من قاعدة البيانات مباشرة.')),
      h('p', { class: 'small' }, 'الاتصال مشفّر. جميع العمليات تُسجَّل في سجل التدقيق.')),
    h('section', { class: 'login-form' }, form)));
  u.input.focus();
}

async function forcePasswordChange() {
  const cur = fld({ label: 'كلمة المرور الحالية', name: 'c', type: 'password', required: true, ltr: true, autocomplete: 'current-password' });
  const nw = fld({ label: 'كلمة المرور الجديدة', name: 'n', type: 'password', required: true, ltr: true, hint: '10 أحرف على الأقل وتحتوي حروفًا وأرقامًا', autocomplete: 'new-password' });
  const err = h('div', { role: 'alert' });
  const form = h('form', { novalidate: true }, h('h2', {}, 'تغيير كلمة المرور'), h('div', { class: 'alert info' }, icon('alert'), 'يجب تعيين كلمة مرور جديدة قبل المتابعة.'), err, cur.root, nw.root, h('button', { class: 'btn primary', type: 'submit' }, 'حفظ ومتابعة'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); mount(err);
    try { await api('/auth/password', { method: 'POST', body: { current_password: cur.input.value, new_password: nw.input.value } }); toast('تم تغيير كلمة المرور', 'ok'); await boot(); }
    catch (ex) { mount(err, h('div', { class: 'alert bad' }, icon('alert'), errMsg(ex))); if (ex.details?.password) nw.setError(ex.details.password); }
  });
  mount(app, h('main', { class: 'login' }, h('section', { class: 'login-art' }), h('section', { class: 'login-form' }, form)));
}

// ───────── الهيكل ─────────
let sideEl, scrim, titleEl, contentEl, bellBadge;
function renderShell() {
  const org = state.meta.org;
  const name = org.name || 'جمعية هدية';
  const groups = [...new Set(NAV.map((n) => n.group))];
  const nav = h('nav', { class: 'nav', 'aria-label': 'التنقل الرئيسي' });
  for (const g of groups) {
    const items = NAV.filter((n) => n.group === g && allowed(n.id));
    if (!items.length) continue;
    nav.append(h('h4', {}, g));
    for (const n of items) {
      const a = h('a', { href: n.href, dataset: { nav: n.id } }, icon(n.icon), n.label);
      if (n.id === 'notifications') { bellBadge = h('span', { class: 'badge-n', hidden: true }); a.append(bellBadge); }
      nav.append(a);
    }
  }
  sideEl = h('aside', { class: 'side', id: 'side' },
    h('div', { class: 'brand' }, org.logo ? h('img', { src: '/branding/logo', alt: '' }) : h('div', { class: 'mark' }, name.slice(0, 1)), h('div', {}, h('b', {}, name), h('span', {}, 'إدارة الجمعية العمومية'))),
    nav,
    h('div', { class: 'side-foot' }, h('div', {}, state.user.full_name), h('div', {}, state.user.role_name)));
  titleEl = h('h1', { id: 'page-title' });
  const search = h('input', { type: 'search', placeholder: 'بحث سريع: اسم، رقم عضوية، جوال…', 'aria-label': 'بحث في الأعضاء', name: 'q' });
  const gs = can('members.view') ? h('form', { class: 'gsearch', role: 'search', onSubmit: (e) => { e.preventDefault(); location.hash = `#/members?q=${encodeURIComponent(search.value.trim())}`; search.value = ''; } }, search, icon('search')) : null;
  const themeBtn = h('button', { class: 'btn ghost iconbtn', type: 'button', title: 'تبديل الوضع الفاتح/الداكن', 'aria-label': 'تبديل الوضع الفاتح/الداكن' }, icon(isDark() ? 'sun' : 'moon'));
  themeBtn.addEventListener('click', () => { setTheme(isDark() ? 'light' : 'dark'); themeBtn.replaceChildren(icon(isDark() ? 'sun' : 'moon')); });
  const hijriBtn = h('button', { class: 'btn ghost iconbtn', type: 'button', title: 'إظهار التاريخ الهجري', 'aria-label': 'إظهار التاريخ الهجري', 'aria-pressed': String(state.hijri) }, icon('calendar'));
  hijriBtn.addEventListener('click', () => { state.hijri = !state.hijri; try { localStorage.setItem('hijri', state.hijri ? '1' : '0'); } catch { /* */ } hijriBtn.setAttribute('aria-pressed', String(state.hijri)); route(); });
  const out = h('button', { class: 'btn ghost iconbtn', type: 'button', title: 'تسجيل الخروج', 'aria-label': 'تسجيل الخروج', onClick: logout }, icon('logout'));
  const menu = h('button', { class: 'btn ghost iconbtn menu', type: 'button', 'aria-label': 'القائمة', 'aria-controls': 'side', 'aria-expanded': 'false', onClick: () => toggleSide(true) }, icon('menu'));
  contentEl = h('main', { class: 'content', id: 'content', tabindex: '-1' });
  scrim = h('div', { class: 'scrim', hidden: true, onClick: () => toggleSide(false) });
  mount(app, h('a', { class: 'skip', href: '#content', onClick: (e) => { e.preventDefault(); contentEl.focus(); } }, 'تخطّي إلى المحتوى'),
    h('div', { class: 'app' }, sideEl, scrim, h('div', { class: 'main' }, h('header', { class: 'top' }, menu, titleEl, gs, hijriBtn, themeBtn, out), contentEl)));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) toggleSide(false); });
  function toggleSide(open) { sideEl.dataset.open = String(open); scrim.hidden = !open; menu.setAttribute('aria-expanded', String(open)); }
}

async function pollUnread() {
  if (!can('notifications.view') || !bellBadge) return;
  try { const { unread } = await api('/notifications/unread-count'); bellBadge.textContent = unread > 99 ? '99+' : String(unread); bellBadge.hidden = !unread; } catch { /* */ }
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* */ }
  state.user = null; state.csrf = ''; clearInterval(pollTimer); location.hash = '#/'; await renderLogin();
}

// ───────── التوجيه ─────────
export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, q = ''] = raw.split('?');
  return { path: path.replace(/\/$/, ''), query: Object.fromEntries(new URLSearchParams(q)) };
}
async function route() {
  if (!state.user || !contentEl) return;
  const token = ++navToken;
  cleanup?.(); cleanup = null;
  const { path, query } = parseHash();
  const r = ROUTES.find((x) => x.path.test(path));
  const hit = r && r.perm() ? r : null;
  document.querySelectorAll('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', false) || (a.dataset.nav === (hit?.id || '') && a.setAttribute('aria-current', 'page')));
  if (!hit) {
    titleEl.textContent = r ? 'غير مصرح' : 'الصفحة غير موجودة';
    mount(contentEl, h('div', { class: 'panel' }, empty(r ? 'ليست لديك صلاحية لعرض هذه الصفحة' : 'الصفحة غير موجودة', 'تواصل مع مدير النظام إن كنت تحتاج هذا الوصول.', btn('العودة للرئيسية', { cls: 'primary', onClick: () => { location.hash = '#/'; } }))));
    return;
  }
  const params = r.path.exec(path).slice(1);
  titleEl.textContent = hit.title; document.title = `${hit.title} – ${state.meta.org.name}`;
  mount(contentEl, skeleton(8));
  try {
    const mod = await import(hit.mod);
    if (token !== navToken) return;
    const root = h('div'); mount(contentEl, root);
    cleanup = (await mod.default(root, { params, query, setTitle: (t) => { titleEl.textContent = t; document.title = `${t} – ${state.meta.org.name}`; }, refreshBell: pollUnread })) || null;
    if (token === navToken) { window.scrollTo(0, 0); contentEl.focus({ preventScroll: true }); }
  } catch (e) {
    if (token !== navToken) return;
    console.error(e);
    mount(contentEl, h('div', { class: 'panel' }, h('div', { class: 'panel-b' }, h('div', { class: 'alert bad', role: 'alert' }, icon('alert'), errMsg(e)))));
  }
}

async function boot() {
  try {
    const me = await api('/auth/me');
    state.user = me.user; state.perms = new Set(me.permissions); state.csrf = me.csrf;
  } catch (e) {
    if (e.status === 401) return renderLogin();
    return mount(app, h('div', { class: 'boot' }, errMsg(e), h('div', {}, btn('إعادة المحاولة', { onClick: boot }))));
  }
  if (state.user.must_change_password) return forcePasswordChange();
  try { state.meta = await api('/meta'); } catch (e) { return mount(app, h('div', { class: 'boot' }, errMsg(e))); }
  try { state.hijri = localStorage.getItem('hijri') === '1'; } catch { /* */ }
  applyBrand(); renderShell(); pollUnread();
  clearInterval(pollTimer); pollTimer = setInterval(pollUnread, 60000);
  await route();
}

window.addEventListener('hashchange', route);
window.addEventListener('session-expired', () => { if (state.user) { state.user = null; renderLogin('انتهت الجلسة. سجّل الدخول مجددًا.'); } });
window.addEventListener('password-change', forcePasswordChange);
boot();
