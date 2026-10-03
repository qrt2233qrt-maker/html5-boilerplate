// What managers and employees can do. Owner-only powers are shown locked so
// the owner sees they exist but can't hand them out.
import { api } from '../api.js';
import { t } from '../i18n.js';
import { ICON } from '../icons.js';
import { S, bpath } from '../state.js';
import { skeletonRows, toast, toastError } from '../ui.js';
import { $, $$, LS, html, mount } from '../util.js';

let role = 'manager';

export const permissionsPage = {
  title: () => t('permissions'),
  async render(view) {
    LS.set(`perms-reviewed:${S.business.id}`, '1');
    mount(view, html`<p class="muted">${t('permsIntro')}</p>
      <div class="tabbar" role="tablist" aria-label="${t('editRole')}">
        ${['manager', 'employee'].map((r) => html`<button type="button" role="tab" data-role="${r}" aria-selected="${role === r}">${t(`role_${r}`)}</button>`)}
      </div>
      <div id="perm-body">${skeletonRows(8)}</div>`);
    let matrix;
    try {
      matrix = await api.get(bpath('/permissions'));
    } catch (err) {
      return toastError(err);
    }
    if (!view.isConnected) return;
    const body = $('#perm-body', view);
    const permRow = (p) => {
      const r = p.roles[role];
      return html`<div class="perm"><div class="mid"><b id="pl-${p.key}">${t(`p.${p.key}`)}</b>
        ${r.overridden ? html`<small><span class="pill info">${t('changed')}</span><button class="linkbtn" type="button" data-reset="${p.key}">${t('reset')}</button></small>` : ''}</div>
        <label class="switch"><input type="checkbox" role="switch" data-p="${p.key}" ${r.allowed ? 'checked' : ''} aria-labelledby="pl-${p.key}"><span></span></label></div>`;
    };
    const draw = () => {
      const groups = new Map();
      for (const p of matrix.filter((x) => !x.ownerOnly)) {
        if (!groups.has(p.group)) groups.set(p.group, []);
        groups.get(p.group).push(p);
      }
      const ownerOnly = matrix.filter((x) => x.ownerOnly);
      mount(body, html`
        ${[...groups].map(([g, perms]) => html`<section class="perm-group"><h3>${t(`group_${g}`)}</h3><div class="listbox">
          ${perms.map(permRow)}</div></section>`)}
        <section class="perm-group"><h3>${t('ownerOnlyTitle')}</h3><p class="hint">${t('ownerOnlyBody')}</p><div class="listbox">
          ${ownerOnly.map((p) => html`<div class="perm"><span class="lock">${ICON.lock}</span><div class="mid"><b>${t(`p.${p.key}`)}</b></div></div>`)}
        </div></section>`);
    };
    const save = async (key, value, input) => {
      try {
        matrix = await api.put(bpath(`/permissions/${role}`), { [key]: value });
        draw();
        toast(t('saved'), { ms: 1600 });
      } catch (err) {
        if (input) input.checked = !input.checked;
        toastError(err);
      }
    };
    body.onchange = (ev) => { const i = ev.target.closest('[data-p]'); if (i) save(i.dataset.p, i.checked, i); };
    body.onclick = (ev) => { const r = ev.target.closest('[data-reset]'); if (r) save(r.dataset.reset, null); };
    $$('[data-role]', view).forEach((b) => {
      b.onclick = () => {
        role = b.dataset.role;
        $$('[data-role]', view).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        draw();
      };
    });
    draw();
  },
};
