// Activity log: who did what, when, with before and after values.
import { api, qs } from '../api.js';
import { fmtDateTime, has, relTime, t } from '../i18n.js';
import { ICON } from '../icons.js';
import { bpath } from '../state.js';
import { busy, skeletonRows, syncList, toastError } from '../ui.js';
import { $, deviceName, html, initials, mount } from '../util.js';

const FILTERS = ['', 'member', 'invitation', 'permissions', 'business'];
const st = { action: '', from: '', to: '', items: [], next: null };

function describe(e) {
  const actor = e.actor?.name || t('system');
  let target = e.targetName || t('someone');
  if (e.action === 'permissions.role_updated') target = t(`roles_${e.targetId}`);
  const key = `a.${e.action}`;
  return has(key) ? t(key, { actor, target }) : t('a.other', { actor, action: e.action });
}

const pretty = (v) => (v === null || v === undefined ? '—' : JSON.stringify(v, null, 2));

function row(e) {
  const dev = deviceName(e.userAgent);
  const devLabel = dev ? t('browserOn', { browser: dev.browser || '?', os: dev.os || '?' }) : null;
  const hasDiff = e.before || e.after;
  return html`<div class="audit-row">
    <button class="row" type="button" data-open="${e.id}" aria-expanded="false" aria-controls="ad-${e.id}">
      <span class="avatar" aria-hidden="true">${initials(e.actor?.name || '·')}</span>
      <span class="mid"><span class="t1">${describe(e)}</span><span class="t2"><time datetime="${e.createdAt}" title="${fmtDateTime(e.createdAt)}">${relTime(e.createdAt)}</time></span></span>
      <span class="chev">${ICON.down}</span></button>
    <div class="collapse" id="ad-${e.id}"><div class="inner"><div class="audit-detail">
      <dl class="kv"><dt>${t('when')}</dt><dd>${fmtDateTime(e.createdAt)}</dd>
        ${devLabel ? html`<dt>${t('device')}</dt><dd>${devLabel}</dd>` : ''}
        ${e.ip ? html`<dt>${t('ipAddress')}</dt><dd class="ltr">${e.ip}</dd>` : ''}</dl>
      ${hasDiff ? html`<div class="diff"><div><div class="lbl">${t('before')}</div><pre>${pretty(e.before)}</pre></div>
        <div><div class="lbl">${t('after')}</div><pre>${pretty(e.after)}</pre></div></div>` : ''}
    </div></div></div>
  </div>`;
}

export const auditPage = {
  title: () => t('audit'),
  render(view) {
    mount(view, html`<div class="toolbar">
        <select class="input" id="a-filter" aria-label="${t('allActivity')}">
          ${FILTERS.map((f) => html`<option value="${f}" ${st.action === f ? 'selected' : ''}>${f ? t(`filter_${f}`) : t('allActivity')}</option>`)}
        </select>
        <label class="inline">${t('from')} <input class="input" type="date" id="a-from" value="${st.from}"></label>
        <label class="inline">${t('to')} <input class="input" type="date" id="a-to" value="${st.to}"></label>
      </div>
      <div id="a-box">${skeletonRows(6)}</div>
      <div class="empty hidden" id="a-empty">${t('noActivity')}</div>
      <p><button class="btn block hidden" type="button" id="a-more">${t('loadMore')}</button></p>`);
    const reload = () => load(view);
    $('#a-filter', view).onchange = (e) => { st.action = e.target.value; reload(); };
    $('#a-from', view).onchange = (e) => { st.from = e.target.value; reload(); };
    $('#a-to', view).onchange = (e) => { st.to = e.target.value; reload(); };
    $('#a-more', view).onclick = (e) => load(view, true, e.currentTarget);
    view.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-open]');
      if (!b) return;
      const c = $(`#ad-${b.dataset.open}`, view);
      const open = c.classList.toggle('open');
      b.setAttribute('aria-expanded', String(open));
    });
    reload();
  },
};

let reqId = 0;
async function load(view, more = false, btn) {
  const req = ++reqId;
  if (btn) busy(btn);
  // Dates are whole local days.
  const from = st.from ? new Date(`${st.from}T00:00:00`).toISOString() : '';
  const to = st.to ? new Date(new Date(`${st.to}T00:00:00`).getTime() + 86400000).toISOString() : '';
  try {
    const res = await api.get(bpath(`/audit-logs${qs({ action: st.action, from, to, limit: 50, before: more ? st.next : '' })}`));
    if (req !== reqId || !view.isConnected) return;
    st.items = more ? [...st.items, ...res.items] : res.items;
    st.next = res.nextBefore;
    let list = $('#a-list', view);
    if (!list) {
      mount($('#a-box', view), html`<div class="listbox list" id="a-list"></div>`);
      list = $('#a-list', view);
    }
    syncList(list, st.items.map((e) => ({ key: String(e.id), tpl: row(e) })));
    list.classList.toggle('hidden', !st.items.length);
    $('#a-empty', view).classList.toggle('hidden', st.items.length > 0);
    $('#a-more', view).classList.toggle('hidden', !st.next);
  } catch (err) {
    toastError(err);
  } finally {
    if (btn) busy(btn, false);
  }
}
