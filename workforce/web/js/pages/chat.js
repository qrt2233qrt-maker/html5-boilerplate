// Team chat and private one-to-one chats. New messages arrive by polling a
// few seconds apart while a conversation is open; nothing runs in between.
import { api } from '../api.js';
import { t } from '../i18n.js';
import { ICON } from '../icons.js';
import { go } from '../router.js';
import { S, bpath, isOwner } from '../state.js';
import { dayLabel, time, todayLocal, isoToZoned } from '../fmt.js';
import { empty, statusPill } from '../components.js';
import { busy, closeSheet, confirmDialog, openSheet, skeletonRows, toastError } from '../ui.js';
import { $, html, initials, mount } from '../util.js';

const POLL_MS = 4000;
let pollTimer = 0;

// Unread messages across every conversation, shown on the Chat nav item.
export async function refreshChatBadge() {
  if (!S.business) return;
  try {
    const { unread } = await api.get(bpath('/chat/unread'));
    document.querySelectorAll('[data-chat-badge]').forEach((b) => {
      b.hidden = !unread;
      b.textContent = unread > 99 ? '99+' : String(unread);
    });
  } catch { /* offline */ }
}

// "Discuss" on a holiday or shift request: opens the private chat about it.
export async function discussRequest(requestId, btn) {
  try {
    if (btn) busy(btn);
    const r = await api.post(bpath('/chat/discuss'), { requestId });
    go(`/chat?thread=${r.threadId}&ref=${r.requestId}`);
  } catch (err) {
    if (btn) busy(btn, false);
    toastError(err);
  }
}

const threadName = (th) => (th.kind === 'team' ? t('teamChat') : th.otherName);

function whenShort(iso) {
  const z = isoToZoned(iso);
  return z.day === todayLocal() ? time(iso) : dayLabel(iso, { day: 'numeric', month: 'short' });
}

const requestLabel = (ref) => {
  if (!ref?.requestType) return t('requestRemoved');
  const span = ref.startsAt ? (ref.requestType === 'time_off'
    ? `${dayLabel(ref.startsAt)} – ${dayLabel(new Date(new Date(ref.endsAt) - 1).toISOString())}`
    : `${dayLabel(ref.startsAt)} ${time(ref.startsAt)}–${time(ref.endsAt)}`) : '';
  return `${t(`req_${ref.requestType}`)}${span ? ` · ${span}` : ''}`;
};

export const chatPage = {
  title: () => t('chat'),
  async render(view, { query }) {
    clearTimeout(pollTimer);
    const id = query.get('thread');
    if (id) return threadView(view, id, query.get('ref'));
    return listView(view);
  },
};

// ---------- conversation list ----------

async function listView(view) {
  mount(view, html`<div class="toolbar"><span class="grow"></span>
      <button class="btn small primary" type="button" id="new-chat">${ICON.plus}${t('newMessage')}</button></div>
    <div id="threads">${skeletonRows(4)}</div>`);
  $('#new-chat', view).onclick = pickPerson;
  const draw = async () => {
    let threads;
    try { threads = await api.get(bpath('/chat/threads')); } catch { return; }
    const box = $('#threads', view);
    if (!box?.isConnected) return;
    mount(box, html`<div class="listbox chat-list">${threads.map((th) => html`<a class="row" href="#/chat?thread=${th.id}">
        <span class="avatar ${th.kind === 'team' ? 'team' : ''}" aria-hidden="true">${th.kind === 'team' ? ICON.people : initials(th.otherName)}</span>
        <span class="mid"><span class="t1">${threadName(th)}${th.kind === 'direct' && !th.otherActive ? html` <span class="pill">${t('leftTeam')}</span>` : ''}</span>
          <span class="t2 ${th.unread ? 'strong' : ''}">${th.lastMessage
            ? (th.lastMessage.body === null ? t('messageRemoved') : `${th.lastMessage.mine ? `${t('you')}: ` : th.kind === 'team' ? `${th.lastMessage.sender}: ` : ''}${th.lastMessage.body}`)
            : th.kind === 'team' ? t('teamChatEmpty') : t('noMessagesYet')}</span></span>
        <span class="end chat-meta">${th.lastMessage ? html`<span class="t2 num">${whenShort(th.lastMessage.at)}</span>` : ''}
          ${th.unread ? html`<span class="badge num">${th.unread > 99 ? '99+' : th.unread}</span>` : ''}</span></a>`)}</div>
      ${threads.length === 1 ? html`<p class="hint">${t('privateChatHint')}</p>` : ''}`);
    pollTimer = setTimeout(draw, POLL_MS * 4);
  };
  await draw();
}

async function pickPerson() {
  const people = await api.get(bpath('/chat/people')).catch((err) => { toastError(err); return null; });
  if (!people) return;
  const sheet = openSheet({
    title: t('newMessage'),
    body: html`<p class="hint">${t('privateChatHint')}</p>
      ${people.length ? html`<input class="input" type="search" id="pq" placeholder="${t('search')}" aria-label="${t('search')}" autocomplete="off">
      <div class="listbox" id="plist">${people.map((p) => html`<button class="row" type="button" data-m="${p.membershipId}" data-n="${p.name.toLowerCase()}">
        <span class="avatar" aria-hidden="true">${initials(p.name)}</span>
        <span class="mid"><span class="t1">${p.name}</span><span class="t2">${[t(`role_${p.role}`), p.jobTitle, p.departmentName].filter(Boolean).join(' · ')}</span></span></button>`)}</div>`
      : empty(t('noColleagues'))}`,
  });
  const q = $('#pq', sheet);
  if (q) q.oninput = () => sheet.querySelectorAll('[data-m]').forEach((b) => { b.hidden = !b.dataset.n.includes(q.value.trim().toLowerCase()); });
  sheet.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = async () => {
      try {
        const r = await api.post(bpath('/chat/direct'), { membershipId: b.dataset.m });
        closeSheet();
        go(`/chat?thread=${r.id}`);
      } catch (err) { toastError(err); }
    };
  });
}

// ---------- one conversation ----------

async function threadView(view, id, refId) {
  mount(view, html`<section class="chat">
    <div class="chat-head"><a class="iconbtn" href="#/chat" aria-label="${t('back')}"><span class="flip">${ICON.chev}</span></a>
      <span class="mid"><b id="ch-name"></b><small id="ch-sub" class="muted"></small></span></div>
    <div class="chat-log" id="log" role="log" aria-live="polite">${skeletonRows(3)}</div>
    <div id="ref-chip"></div>
    <form class="chat-compose" id="compose" novalidate>
      <textarea class="input" id="msg" rows="1" maxlength="2000" placeholder="${t('writeMessage')}" aria-label="${t('writeMessage')}"></textarea>
      <button class="iconbtn primary" type="submit" aria-label="${t('send')}">${ICON.send}</button>
    </form></section>`);
  const log = $('#log', view);
  const form = $('#compose', view);
  const input = $('#msg', view);
  let data;
  try { data = await api.get(bpath(`/chat/threads/${id}/messages`)); } catch {
    mount(log, empty(t('chatNotFound')));
    form.hidden = true;
    return;
  }
  if (!view.isConnected) return;
  const th = data.thread;
  const msgs = data.messages;
  let more = data.more;
  let ref = refId || null;
  $('#ch-name', view).textContent = th.kind === 'team' ? t('teamChat') : th.other.name;
  $('#ch-sub', view).textContent = th.kind === 'team' ? t('teamChatSub', { name: S.business.name }) : `${t(`role_${th.other.role}`)} · ${t('privateChat')}`;
  const closed = th.kind === 'direct' && !th.other.active;
  if (closed) {
    form.replaceWith(Object.assign(document.createElement('p'), { className: 'banner', textContent: t('chatClosedLeft', { name: th.other.name }) }));
  }
  const canRemove = (m) => !m.deleted && (m.mine || (th.kind === 'team' && isOwner()));

  const bubble = (m) => html`<div class="msg ${m.mine ? 'mine' : ''}" data-id="${m.id}">
    ${th.kind === 'team' && !m.mine ? html`<span class="who">${m.senderName}</span>` : ''}
    ${m.ref ? html`<a class="msg-ref" href="#${m.mine ? '/requests' : '/approvals'}">${ICON.calendar}<span>${requestLabel(m.ref)}</span>${m.ref.status ? statusPill(m.ref.status) : ''}</a>` : ''}
    <p class="${m.deleted ? 'muted removed' : ''}" dir="auto">${m.deleted ? t('messageRemoved') : m.body}</p>
    <span class="when num">${time(m.createdAt)}${canRemove(m) ? html`<button class="linkbtn" type="button" data-rm="${m.id}">${t('remove')}</button>` : ''}</span></div>`;

  const draw = () => {
    let lastDay = null;
    const parts = [];
    for (const m of msgs) {
      const d = isoToZoned(m.createdAt).day;
      if (d !== lastDay) { parts.push(html`<div class="day-sep"><span>${d === todayLocal() ? t('today') : dayLabel(m.createdAt, { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>`); lastDay = d; }
      parts.push(bubble(m));
    }
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    mount(log, html`${more ? html`<button class="btn small ghost earlier" type="button" id="earlier">${t('earlierMessages')}</button>` : ''}
      ${msgs.length ? parts : html`<p class="muted chat-empty">${th.kind === 'team' ? t('teamChatEmpty') : t('sayHello', { name: th.other.name })}</p>`}`);
    return nearBottom;
  };
  const toBottom = () => { log.scrollTop = log.scrollHeight; };
  draw();
  toBottom();
  refreshChatBadge();

  const drawRef = () => mount($('#ref-chip', view), ref && !closed ? html`<div class="ref-chip">${ICON.calendar}<span>${t('aboutRequest')}</span>
    <button class="iconbtn sm" type="button" id="ref-x" aria-label="${t('remove')}">×</button></div>` : '');
  drawRef();
  view.addEventListener('click', (e) => { if (e.target.closest('#ref-x')) { ref = null; drawRef(); } });

  // Older messages, without losing the reading position.
  log.addEventListener('click', async (e) => {
    if (e.target.closest('#earlier')) {
      const h = log.scrollHeight;
      const r = await api.get(bpath(`/chat/threads/${id}/messages?before=${msgs[0].id}`)).catch(toastError);
      if (!r) return;
      msgs.unshift(...r.messages);
      more = r.more;
      draw();
      log.scrollTop = log.scrollHeight - h;
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      if (!(await confirmDialog({ title: t('removeMessageQ'), body: t('removeMessageBody'), confirm: t('remove'), danger: true }))) return;
      try {
        await api.del(bpath(`/chat/threads/${id}/messages/${rm.dataset.rm}`));
        const m = msgs.find((x) => x.id === Number(rm.dataset.rm));
        Object.assign(m, { deleted: true, body: null });
        draw();
      } catch (err) { toastError(err); }
    }
  });

  const poll = async () => {
    if (!log.isConnected) return;
    const after = msgs.length ? msgs[msgs.length - 1].id : 0;
    try {
      const r = await api.get(bpath(`/chat/threads/${id}/messages?after=${after}`));
      if (r.messages.length && log.isConnected) {
        msgs.push(...r.messages.filter((m) => !msgs.some((x) => x.id === m.id)));
        if (draw()) toBottom();
        refreshChatBadge();
      }
    } catch { /* offline: try again next time */ }
    if (log.isConnected) pollTimer = setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS);
  };
  pollTimer = setTimeout(poll, POLL_MS);

  if (closed) return;
  // Grow the box with the text; Enter sends, Shift+Enter makes a new line.
  const fit = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; };
  input.addEventListener('input', fit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    const btn = $('button[type=submit]', form);
    busy(btn);
    try {
      const m = await api.post(bpath(`/chat/threads/${id}/messages`), ref ? { body, refType: 'shift_request', refId: ref } : { body });
      // The request is attached once; follow-ups are plain messages.
      if (ref) {
        const page = await api.get(bpath(`/chat/threads/${id}/messages?after=${m.id - 1}`)).catch(() => null);
        Object.assign(m, page?.messages.find((x) => x.id === m.id) ?? {});
        ref = null;
        drawRef();
        history.replaceState(null, '', `#/chat?thread=${id}`);
      }
      if (!msgs.some((x) => x.id === m.id)) msgs.push(m);
      input.value = '';
      fit();
      draw();
      toBottom();
    } catch (err) {
      toastError(err);
    } finally {
      busy(btn, false);
      input.focus();
    }
  };
  if (matchMedia('(pointer: fine)').matches) input.focus();
}
