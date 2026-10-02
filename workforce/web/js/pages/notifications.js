// Notification centre (spec §22).
import { api } from '../api.js';
import { relTime, t } from '../i18n.js';
import { bpath } from '../state.js';
import { money } from '../fmt.js';
import { empty } from '../components.js';
import { skeletonRows, toastError } from '../ui.js';
import { $, html, mount } from '../util.js';

// Where tapping a notification takes you.
const LINKS = {
  shift: '/schedule', schedule: '/schedule', request: '/approvals?tab=requests', time_off: '/requests', swap: '/requests',
  expense: '/expenses', salary: '/pay', alert: '/analytics', finance: '/finance', invitation: '/team', role: '/home', member: '/home',
};
const linkFor = (n) => {
  const [group, kind] = n.type.split('.');
  if (n.type === 'expense.submitted' || n.type === 'expense.owner_approval') return '/approvals?tab=expenses';
  if (n.type === 'swap.awaiting_approval') return '/approvals?tab=swaps';
  if (group === 'request' && ['approved', 'rejected'].includes(kind)) return '/requests';
  return LINKS[group] || '/home';
};

export function noticeText(n) {
  const d = { ...n.data };
  for (const k of ['amount', 'net', 'current', 'previous']) if (typeof d[k] === 'number') d[k] = money(d[k]);
  return t(`n.${n.type}`, d);
}

export const notificationsPage = {
  title: () => t('notifications'),
  async render(view) {
    mount(view, html`<div class="toolbar"><span class="spacer"></span><button class="btn small" type="button" id="all">${t('markAllRead')}</button></div><div id="list">${skeletonRows(6)}</div>`);
    const draw = async () => {
      const r = await api.get(bpath('/notifications?limit=100'));
      if (!view.isConnected) return;
      mount($('#list', view), r.items.length ? html`<div class="listbox">${r.items.map((n) => html`<a class="row ${n.readAt ? '' : 'unread'}" href="#${linkFor(n)}" data-n="${n.id}">
        <span class="dotmark" aria-hidden="true"></span><span class="mid"><span class="t1">${noticeText(n)}</span><span class="t2">${relTime(n.createdAt)}</span></span></a>`)}</div>`
        : empty(t('noNotifications')));
      $('#list', view).onclick = (e) => { const a = e.target.closest('[data-n]'); if (a) api.post(bpath(`/notifications/${a.dataset.n}/read`)).catch(() => {}); };
    };
    $('#all', view).onclick = async () => { await api.post(bpath('/notifications/read-all')); draw(); document.dispatchEvent(new Event('notifications:changed')); };
    draw().catch(toastError);
  },
};
