// Sign in, two-step verification, registration, verification, password
// recovery and invitation acceptance.
import { api } from '../api.js';
import { LANG, setLang, t } from '../i18n.js';
import { ICON, guilloche } from '../icons.js';
import { go } from '../router.js';
import { S, clearSession, loadMe, pendingVerification, pickBusiness } from '../state.js';
import { busy, errorMessage, field, fieldError, onSubmit, passwordToggles, toast, toastError } from '../ui.js';
import { $, SS, html, mount } from '../util.js';

let heroDrawn = false;

// Split layout: banknote hero beside (desktop) or above (phone) the form.
function authShell(root, content) {
  const draw = !heroDrawn;
  heroDrawn = true;
  mount(root, html`<div class="auth">
    <aside class="auth-hero note ${draw ? 'draw' : ''}">${guilloche()}
      <div class="auth-brand"><span class="mark">${ICON.people}</span><span>${t('appName')}</span></div>
      <p class="auth-tag-lg">${t('taglineLg')}</p>
      <p class="auth-tag">${t('tagline')}</p>
    </aside>
    <main class="auth-main">
      <div class="auth-top"><button class="pillbtn" type="button" id="auth-lang" aria-label="${t('switchLang')}">${t('lang')}</button></div>
      <div class="auth-card" id="auth-card">${content}</div>
    </main>
  </div>`);
  $('#auth-lang', root).onclick = () => {
    setLang(LANG === 'ar' ? 'en' : 'ar');
    import('../router.js').then((r) => r.render());
  };
  const card = $('#auth-card', root);
  passwordToggles(card);
  $('h1', card)?.setAttribute('tabindex', '-1');
  return card;
}

function step(card, content) {
  mount(card, html`<div class="auth-step">${content}</div>`);
  passwordToggles(card);
  return card;
}

async function afterLogin() {
  await loadMe();
  const next = SS.get('next');
  SS.del('next');
  go(pendingVerification() ? '/verify' : (next || '/home'), { replace: true });
}

const codeField = (label = t('code')) => field({
  name: 'code', label, autocomplete: 'one-time-code', inputmode: 'numeric', required: true, cls: 'code-input',
  attrs: html`maxlength="6" pattern="[0-9٠-٩]*"`,
});

const successMark = html`<div class="success-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>`;

// ---------- sign in ----------

export const loginPage = {
  layout: 'auth',
  guestOnly: true,
  render(root) {
    const card = authShell(root, html`
      <h1>${t('signInTitle')}</h1><p class="muted">${t('signInBody')}</p>
      <form id="login" novalidate>
        <div class="form-error" role="alert"></div>
        ${field({ name: 'identifier', label: t('identifier'), autocomplete: 'username', required: true, attrs: html`dir="auto" autocapitalize="none" spellcheck="false"` })}
        ${field({ name: 'password', label: t('password'), type: 'password', autocomplete: 'current-password', required: true })}
        <p><a href="#/forgot">${t('forgot')}</a></p>
        <button class="btn primary block" type="submit">${t('signIn')}</button>
      </form>
      <p class="auth-foot">${t('newBusiness')} <a href="#/register">${t('createAccount')}</a></p>`);
    const form = $('#login', card);
    onSubmit(form, async (d) => {
      const res = await api.post('/api/auth/login', { identifier: d.identifier, password: d.password });
      if (res.twoFactorRequired) return twoFactorStep(card, res.challenge);
      await afterLogin();
    }, { fieldMap: { invalid_credentials: 'password' } });
    $('#f-identifier', card).focus();
  },
};

function twoFactorStep(card, challenge, recovery = false) {
  const input = recovery
    ? field({ name: 'code', label: t('recoveryCode'), autocomplete: 'off', required: true, attrs: html`dir="ltr" autocapitalize="characters" spellcheck="false" maxlength="12"` })
    : codeField();
  step(card, html`
    <h1>${t('twoFactorTitle')}</h1><p class="muted">${recovery ? t('recoveryBody') : t('twoFactorBody')}</p>
    <form id="tfa" novalidate>
      <div class="form-error" role="alert"></div>
      ${input}
      <button class="btn primary block" type="submit">${t('verify')}</button>
    </form>
    <p class="auth-foot"><button class="linkbtn" type="button" id="tfa-switch">${recovery ? t('useApp') : t('useRecovery')}</button></p>`);
  const form = $('#tfa', card);
  onSubmit(form, async (d) => {
    try {
      await api.post('/api/auth/login/2fa', { challenge, code: d.code });
    } catch (err) {
      if (err.code === 'challenge_expired') {
        toast(errorMessage(err), { error: true });
        return loginPage.render(card.closest('#root'));
      }
      throw err;
    }
    await afterLogin();
  });
  $('#tfa-switch', card).onclick = () => twoFactorStep(card, challenge, !recovery);
  $('#f-code', card).focus();
}

// ---------- register ----------

export const registerPage = {
  layout: 'auth',
  guestOnly: true,
  render(root) {
    const card = authShell(root, html`
      <h1>${t('registerTitle')}</h1><p class="muted">${t('registerBody')}</p>
      <form id="register" novalidate>
        <div class="form-error" role="alert"></div>
        ${field({ name: 'businessName', label: t('businessName'), autocomplete: 'organization', required: true })}
        <div class="field"><label class="label" for="f-businessKind">${t('businessKind')}</label>
          <select class="input" id="f-businessKind" name="businessKind"><option value="restaurant">${t('kind_restaurant')}</option><option value="general">${t('kind_general')}</option></select>
          <p class="hint">${t('businessKindHint')}</p></div>
        ${field({ name: 'name', label: t('yourName'), autocomplete: 'name', required: true })}
        ${field({ name: 'email', label: t('email'), type: 'email', autocomplete: 'email', hint: t('contactHint'), attrs: html`dir="ltr" autocapitalize="none" spellcheck="false"` })}
        ${field({ name: 'phone', label: t('phone'), type: 'tel', autocomplete: 'tel', inputmode: 'tel', optional: true, attrs: html`dir="ltr"` })}
        ${field({ name: 'password', label: t('password'), type: 'password', autocomplete: 'new-password', required: true, hint: t('passwordHint') })}
        <button class="btn primary block" type="submit">${t('createBtn')}</button>
      </form>
      <p class="auth-foot">${t('haveAccount')} <a href="#/login">${t('signIn')}</a></p>`);
    const form = $('#register', card);
    onSubmit(form, async (d) => {
      if (!d.email && !d.phone) return fieldError(form, 'email', t('e.contact_required'));
      await api.post('/api/auth/register', {
        businessName: d.businessName, businessKind: d.businessKind, name: d.name, email: d.email, phone: d.phone, password: d.password, locale: LANG,
      });
      await loadMe();
      go('/verify', { replace: true });
    }, { fieldMap: { account_exists: 'email' } });
    $('#f-businessName', card).focus();
  },
};

// ---------- verify ----------

export const verifyPage = {
  layout: 'auth',
  render(root, { query }) {
    if (!S.me) {
      SS.set('next', `/verify?${query}`);
      return go('/login', { replace: true });
    }
    const u = S.me.user;
    // An explicit channel (from the account page) or whatever sign-in still needs.
    const wanted = query.get('channel');
    const open = (c) => (c === 'email' ? u.email && !u.emailVerified : u.phone && !u.phoneVerified);
    const channel = wanted && open(wanted) ? wanted : pendingVerification();
    if (!channel) return go('/home', { replace: true });
    const fromAccount = query.get('send') === '1';
    const to = channel === 'email' ? u.email : u.phone;
    const card = authShell(root, html`
      <h1>${t('verifyTitle')}</h1>
      <p class="muted">${t(channel === 'email' ? 'verifyEmailBody' : 'verifyPhoneBody', { to })}</p>
      <form id="verify" novalidate>
        <div class="form-error" role="alert"></div>
        ${codeField()}
        <button class="btn primary block" type="submit">${t('verify')}</button>
      </form>
      <p class="auth-foot"><button class="linkbtn" type="button" id="resend">${t('resend')}</button></p>
      <p class="auth-foot">${t('wrongAccount')} <button class="linkbtn" type="button" id="signout">${t('signOut')}</button></p>`);
    const form = $('#verify', card);
    onSubmit(form, async (d) => {
      await api.post(`/api/auth/verify/${channel}`, { code: d.code });
      step(card, html`${successMark}<h1>${t('verifiedOk')}</h1>`);
      await loadMe();
      setTimeout(() => {
        if (pendingVerification()) verifyPage.render(root, { query: new URLSearchParams() });
        else go(fromAccount ? '/account' : '/home', { replace: true });
      }, 900);
    });
    const resend = async (btn) => {
      busy(btn);
      try {
        await api.post(`/api/auth/verify/${channel}/request`);
        toast(t('resent'));
      } catch (err) {
        toastError(err);
      } finally {
        busy(btn, false);
      }
    };
    $('#resend', card).onclick = (ev) => resend(ev.currentTarget);
    if (fromAccount) {
      // Send once, then drop the flag so a refresh doesn't send again.
      history.replaceState(null, '', `#/verify?channel=${channel}`);
      resend($('#resend', card));
    }
    $('#signout', card).onclick = signOut;
    const code = query.get('code');
    const input = $('#f-code', card);
    if (code && query.get('channel') === channel) {
      input.value = code;
      form.requestSubmit();
    } else {
      input.focus();
    }
  },
};

// ---------- forgot / reset ----------

export const forgotPage = {
  layout: 'auth',
  guestOnly: true,
  render(root) {
    const card = authShell(root, html`
      <h1>${t('forgotTitle')}</h1><p class="muted">${t('forgotBody')}</p>
      <form id="forgot" novalidate>
        <div class="form-error" role="alert"></div>
        ${field({ name: 'identifier', label: t('identifier'), autocomplete: 'username', required: true, attrs: html`dir="auto" autocapitalize="none" spellcheck="false"` })}
        <button class="btn primary block" type="submit">${t('send')}</button>
      </form>
      <p class="auth-foot"><a href="#/login">${t('back')}</a></p>`);
    onSubmit($('#forgot', card), async (d) => {
      await api.post('/api/auth/password/forgot', { identifier: d.identifier });
      if (d.identifier.includes('@')) {
        step(card, html`${successMark}<h1>${t('forgotTitle')}</h1><p class="muted">${t('forgotSentEmail', { to: d.identifier })}</p>
          <a class="btn block" href="#/login">${t('signIn')}</a>`);
        return;
      }
      smsResetStep(card, d.identifier);
    });
    $('#f-identifier', card).focus();
  },
};

function smsResetStep(card, identifier) {
  step(card, html`
    <h1>${t('resetTitle')}</h1><p class="muted">${t('forgotSentPhone', { to: identifier })}</p>
    <form id="smsreset" novalidate>
      <div class="form-error" role="alert"></div>
      ${codeField(t('smsCode'))}
      ${field({ name: 'password', label: t('newPassword'), type: 'password', autocomplete: 'new-password', required: true, hint: t('passwordHint') })}
      <button class="btn primary block" type="submit">${t('savePassword')}</button>
    </form>`);
  onSubmit($('#smsreset', card), async (d) => {
    await api.post('/api/auth/password/reset', { identifier, code: d.code, password: d.password });
    resetDone(card);
  });
  $('#f-code', card).focus();
}

function resetDone(card) {
  clearSession();
  step(card, html`${successMark}<h1>${t('resetDone')}</h1><a class="btn primary block" href="#/login">${t('signIn')}</a>`);
}

export const resetPage = {
  layout: 'auth',
  render(root, { query }) {
    const token = query.get('token');
    if (!token) return go('/forgot', { replace: true });
    const card = authShell(root, html`
      <h1>${t('resetTitle')}</h1>
      <form id="reset" novalidate>
        <div class="form-error" role="alert"></div>
        ${field({ name: 'password', label: t('newPassword'), type: 'password', autocomplete: 'new-password', required: true, hint: t('passwordHint') })}
        <button class="btn primary block" type="submit">${t('savePassword')}</button>
      </form>`);
    onSubmit($('#reset', card), async (d) => {
      await api.post('/api/auth/password/reset', { token, password: d.password });
      resetDone(card);
    });
    $('#f-password', card).focus();
  },
};

// ---------- invitation ----------

export const invitePage = {
  layout: 'auth',
  async render(root, { query }) {
    const token = query.get('token') || '';
    const card = authShell(root, html`<div class="skeleton sk-panel" aria-label="${t('loading')}"></div>`);
    let inv;
    try {
      inv = await api.get(`/api/invitations/${encodeURIComponent(token)}`);
    } catch (err) {
      const msg = err.status === 404 ? t('inviteInvalid') : errorMessage(err);
      return step(card, html`<h1>${t('inviteInvalid')}</h1><p class="muted">${msg}</p><a class="btn block" href="#/login">${t('signIn')}</a>`);
    }
    const closed = { expired: 'inviteExpired', accepted: 'inviteUsed', revoked: 'inviteRevoked' }[inv.status];
    if (closed) {
      return step(card, html`<h1>${t('inviteTitle', { business: inv.businessName })}</h1><p class="muted">${t(closed)}</p>
        <a class="btn block" href="#/login">${t('signIn')}</a>`);
    }
    const role = t(`roleA_${inv.role}`);
    const intro = html`<h1>${t('inviteTitle', { business: inv.businessName })}</h1>
      <p class="muted">${t('inviteBody', { business: inv.businessName, role })}</p>`;
    const joined = async () => {
      await loadMe();
      pickBusiness(inv.businessId);
      toast(t('welcomeTo', { business: inv.businessName }));
      go('/home', { replace: true });
    };

    if (S.me) {
      step(card, html`${intro}<p>${t('inviteSignedInAs', { name: S.me.user.name })}</p>
        <form id="join" novalidate><div class="form-error" role="alert"></div>
          <button class="btn primary block" type="submit">${t('join', { business: inv.businessName })}</button></form>
        <p class="auth-foot">${t('wrongAccount')} <button class="linkbtn" type="button" id="signout">${t('signOut')}</button></p>`);
      onSubmit($('#join', card), async () => {
        await api.post('/api/invitations/accept', { token });
        await joined();
      });
      $('#signout', card).onclick = signOut;
      return;
    }
    if (inv.accountExists) {
      step(card, html`${intro}<p>${t('inviteSignIn')}</p><button class="btn primary block" type="button" id="go-login">${t('signIn')}</button>`);
      $('#go-login', card).onclick = () => {
        SS.set('next', `/invite?token=${token}`);
        go('/login');
      };
      return;
    }
    step(card, html`${intro}
      <form id="accept" novalidate>
        <div class="form-error" role="alert"></div>
        ${field({ name: 'name', label: t('yourName'), autocomplete: 'name', required: true, value: inv.name })}
        ${field({ name: 'password', label: t('password'), type: 'password', autocomplete: 'new-password', required: true, hint: t('passwordHint') })}
        <button class="btn primary block" type="submit">${t('join', { business: inv.businessName })}</button>
      </form>`);
    onSubmit($('#accept', card), async (d) => {
      await api.post('/api/invitations/accept', { token, name: d.name, password: d.password });
      await joined();
    });
    $('#f-password', card).focus();
  },
};

export async function signOut() {
  try {
    await api.post('/api/auth/logout');
  } catch { /* signed out either way */ }
  clearSession();
  go('/login', { replace: true });
}
