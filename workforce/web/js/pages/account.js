// Account: contact verification, password, two-step verification, devices.
import { api } from '../api.js';
import { LANG, relTime, setLang, t, tn } from '../i18n.js';
import { ICON } from '../icons.js';
import { go, render as rerender } from '../router.js';
import { S, clearSession, loadMe } from '../state.js';
import {
  busy, closeSheet, confirmDialog, copyText, field, onSubmit, openSheet, passwordToggles, removeAnimated, success, toast, toastError,
} from '../ui.js';
import { $, deviceName, html, mount } from '../util.js';

export const accountPage = {
  title: () => t('account'),
  render(view, { query }) {
    const u = S.me.user;
    const contact = (kind, value, ok) => (value ? html`<div class="row">
      <span class="avatar" aria-hidden="true">${kind === 'email' ? ICON.mail : ICON.phone}</span>
      <span class="mid"><span class="t1 ltr">${value}</span><span class="t2">${t(kind)}</span></span>
      <span class="end">${ok ? html`<span class="pill ok">${ICON.check} ${t('verified')}</span>`
        : html`<a class="btn small" href="#/verify?channel=${kind}&send=1">${t('verifyNow')}</a>`}</span></div>` : '');
    mount(view, html`<div class="cols"><div>
      <section class="panel"><h2>${t('profile')}</h2>
        <div class="profile-head"><span class="avatar lg" aria-hidden="true">${u.name.trim()[0]?.toUpperCase()}</span>
          <div><h3>${u.name}</h3><span class="muted">${t(`role_${S.business.role}`)} · ${S.business.name}</span></div></div>
        <h3 class="h2 small">${t('contactVerification')}</h3>
        <div class="listbox">${contact('email', u.email, u.emailVerified)}${contact('phone', u.phone, u.phoneVerified)}</div>
      </section>
      <section class="panel" id="twofa"></section>
      <section class="panel"><h2>${t('changePassword')}</h2>
        <form id="pw-form" novalidate><div class="form-error" role="alert"></div>
          <input type="hidden" name="username" autocomplete="username" value="${u.email || u.phone || ''}">
          ${field({ name: 'currentPassword', label: t('currentPassword'), type: 'password', autocomplete: 'current-password', required: true })}
          ${field({ name: 'newPassword', label: t('newPassword'), type: 'password', autocomplete: 'new-password', required: true, hint: t('passwordHint') })}
          <button class="btn primary" type="submit">${t('savePassword')}</button>
        </form></section>
    </div><div>
      <section class="panel"><div class="panel-head"><h2>${t('devices')}</h2></div><div id="devices"><div class="skeleton sk-row"></div></div>
        <div class="row-gap"><button class="btn small" type="button" id="out-others">${t('signOutOthers')}</button>
        <button class="btn small danger" type="button" id="out-all">${t('signOutAll')}</button></div></section>
      <section class="panel"><h2>${t('notificationSettings')}</h2><p class="muted small">${t('notificationSettingsBody')}</p>
        <div class="perm"><div class="mid"><b>${t('emailCopies')}</b></div><label class="switch"><input type="checkbox" role="switch" data-pref="email" aria-label="${t('emailCopies')}"><span></span></label></div>
        <div class="perm"><div class="mid"><b>${t('smsCopies')}</b><small>${t('smsCopiesHint')}</small></div><label class="switch"><input type="checkbox" role="switch" data-pref="sms" aria-label="${t('smsCopies')}"><span></span></label></div>
        <a class="btn small ghost" href="#/member?id=${S.business.membershipId}">${t('myProfileDetails')}</a></section>
      <section class="panel"><h2>${t('language')}</h2><div class="seg" role="radiogroup" aria-label="${t('language')}">
        ${[['ar', 'العربية'], ['en', 'English']].map(([v, l]) => html`<label><input type="radio" name="lang" value="${v}" ${LANG === v ? 'checked' : ''}><span>${l}</span></label>`)}
      </div></section>
    </div></div>`);

    passwordToggles(view);
    onSubmit($('#pw-form', view), async (d, btn) => {
      await api.post('/api/auth/password/change', { currentPassword: d.currentPassword, newPassword: d.newPassword });
      $('#pw-form', view).reset();
      await success(btn);
      toast(t('passwordChanged'));
      loadDevices(view);
    }, { fieldMap: { weak_password: 'newPassword' } });

    view.querySelectorAll('input[name=lang]').forEach((i) => {
      i.onchange = () => { setLang(i.value); rerender(); };
    });
    $('#out-others', view).onclick = async (ev) => {
      busy(ev.currentTarget);
      try {
        await api.post('/api/auth/logout-all', { keepCurrent: true });
        toast(t('othersSignedOut'));
        loadDevices(view);
      } catch (err) {
        toastError(err);
      } finally {
        busy(ev.currentTarget, false);
      }
    };
    $('#out-all', view).onclick = async () => {
      if (!(await confirmDialog({ title: t('confirmSignOutAllTitle'), body: t('confirmSignOutAllBody'), confirm: t('signOutAll'), danger: true }))) return;
      try {
        await api.post('/api/auth/logout-all', { keepCurrent: false });
      } catch (err) {
        return toastError(err);
      }
      clearSession();
      go('/login', { replace: true });
    };
    drawTwoFactor(view);
    loadDevices(view);
    api.get(`/api/b/${S.business.id}/notification-preferences`).then((prefs) => {
      view.querySelectorAll('[data-pref]').forEach((i) => {
        i.checked = !!prefs[i.dataset.pref];
        i.onchange = () => api.put(`/api/b/${S.business.id}/notification-preferences`, { [i.dataset.pref]: i.checked })
          .then(() => toast(t('saved'), { ms: 1500 }), (err) => { i.checked = !i.checked; toastError(err); });
      });
    }).catch(() => {});
    if (query.get('focus') === '2fa') {
      $('#twofa', view).scrollIntoView({ block: 'start' });
      if (!u.twoFactorEnabled) setupTwoFactor(view);
    }
  },
};

function drawTwoFactor(view) {
  const u = S.me.user;
  const box = $('#twofa', view);
  mount(box, html`<div class="panel-head"><h2>${t('twoStep')}</h2>
      <span class="pill ${u.twoFactorEnabled ? 'ok' : ''}">${u.twoFactorEnabled ? t('on') : t('off')}</span></div>
    <p class="muted">${t('twoStepBody')}</p>
    ${u.twoFactorEnabled ? html`<p class="small muted">${tn('recoveryLeft', u.recoveryCodesLeft)}</p>
      <button class="btn" type="button" id="tfa-off">${t('turnOff')}</button>`
    : html`<button class="btn primary" type="button" id="tfa-on">${ICON.shield}${t('turnOn')}</button>`}`);
  $('#tfa-on', box)?.addEventListener('click', () => setupTwoFactor(view));
  $('#tfa-off', box)?.addEventListener('click', () => disableTwoFactor(view));
}

async function setupTwoFactor(view) {
  let data;
  try {
    data = await api.post('/api/auth/2fa/setup');
  } catch (err) {
    return toastError(err);
  }
  const sheet = openSheet({
    title: t('twoStep'),
    body: html`<p>${t('scanQr')}</p>
      <div class="qr"><img src="${data.qr}" alt="${t('twoStep')}" width="200" height="200">
        <a class="btn small" href="${data.otpauthUrl}">${t('openInApp')}</a></div>
      <p class="small muted">${t('manualKey')}</p><div class="secret" id="secret">${data.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
      <form id="tfa-form" novalidate><div class="form-error" role="alert"></div>
        <p>${t('enterAppCode')}</p>
        ${field({ name: 'code', label: t('code'), autocomplete: 'one-time-code', inputmode: 'numeric', required: true, cls: 'code-input', attrs: html`maxlength="6"` })}
      </form>`,
    foot: html`<button class="btn primary" type="submit" form="tfa-form">${t('turnOn')}</button>`,
  });
  onSubmit($('#tfa-form', sheet), async (d) => {
    const res = await api.post('/api/auth/2fa/enable', { code: d.code });
    await loadMe();
    drawTwoFactor(view);
    showRecoveryCodes(res.recoveryCodes);
    toast(t('twoStepOnToast'));
  });
}

function showRecoveryCodes(codes) {
  const text = codes.join('\n');
  const sheet = openSheet({
    title: t('recoveryTitle'),
    body: html`<p>${t('recoverySave')}</p><ul class="codes">${codes.map((c) => html`<li>${c}</li>`)}</ul>
      <div class="row-gap"><button class="btn small" type="button" id="rc-copy">${t('copy')}</button>
      <button class="btn small" type="button" id="rc-dl">${t('download')}</button></div>`,
    foot: html`<button class="btn primary" type="button" id="rc-done">${t('savedThem')}</button>`,
  });
  $('#rc-copy', sheet).onclick = (ev) => copyText(text, ev.currentTarget);
  $('#rc-dl', sheet).onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${t('recoveryTitle')}\n\n${text}\n`], { type: 'text/plain' }));
    a.download = 'recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#rc-done', sheet).onclick = closeSheet;
}

function disableTwoFactor(view) {
  const sheet = openSheet({
    title: t('turnOff'),
    body: html`<form id="tfa-off-form" novalidate><div class="form-error" role="alert"></div><p>${t('turnOffBody')}</p>
      ${field({ name: 'password', label: t('password'), type: 'password', autocomplete: 'current-password', required: true })}</form>`,
    foot: html`<button class="btn danger" type="submit" form="tfa-off-form">${t('turnOff')}</button>`,
  });
  passwordToggles(sheet);
  onSubmit($('#tfa-off-form', sheet), async (d) => {
    await api.post('/api/auth/2fa/disable', { password: d.password });
    await loadMe();
    drawTwoFactor(view);
    closeSheet();
    toast(t('twoStepOffToast'));
  }, { fieldMap: { wrong_password: 'password' } });
  $('#f-password', sheet).focus();
}

async function loadDevices(view) {
  let sessions;
  try {
    sessions = await api.get('/api/auth/sessions');
  } catch (err) {
    return toastError(err);
  }
  const box = $('#devices', view);
  if (!box) return;
  mount(box, html`${sessions.map((s) => {
    const d = deviceName(s.userAgent);
    const name = d?.browser || d?.os ? t('browserOn', { browser: d.browser || '?', os: d.os || '?' }) : t('unknownDevice');
    return html`<div class="device" data-s="${s.id}"><span class="ic">${d?.mobile ? ICON.mobile : ICON.laptop}</span>
      <span class="mid"><b>${name}</b><small>${s.current ? t('thisDevice') : t('activeAgo', { when: relTime(s.lastSeenAt) })}${s.ip ? html` · <span class="ltr">${s.ip}</span>` : ''}</small></span>
      ${s.current ? html`<span class="pill ok">${t('thisDevice')}</span>` : html`<button class="btn small" type="button" data-out="${s.id}">${t('signOutDevice')}</button>`}</div>`;
  })}`);
  box.onclick = async (ev) => {
    const b = ev.target.closest('[data-out]');
    if (!b) return;
    busy(b);
    try {
      await api.del(`/api/auth/sessions/${b.dataset.out}`);
      await removeAnimated(b.closest('.device'));
      toast(t('deviceSignedOut'));
    } catch (err) {
      busy(b, false);
      toastError(err);
    }
  };
}
