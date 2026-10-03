// Sharing a one-time link by hand (WhatsApp, the phone's share menu, email
// app or copy), so invitations and password resets cost nothing to send.
import { t } from './i18n.js';
import { ICON } from './icons.js';
import { S } from './state.js';
import { copyText, openSheet } from './ui.js';
import { $, html } from './util.js';

// Server can send email / SMS itself? Loaded once from /api/config.
export const sending = () => S.server || { email: false, sms: false };

const waNumber = (phone) => String(phone || '').replace(/\D/g, '').replace(/^0(7\d{9})$/, '964$1');

export function shareSheet({ title, intro, link, message, phone, email, sentBy }) {
  const text = message || link;
  const wa = phone ? `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  const sheet = openSheet({
    title,
    body: html`${sentBy ? html`<p class="banner info">${t(sentBy === 'email' ? 'alsoSentEmail' : 'alsoSentSms')}</p>` : ''}
      <p class="muted">${intro}</p>
      <div class="share-link"><input class="input ltr" id="share-url" readonly value="${link}" aria-label="${t('link')}" dir="ltr">
        <button class="btn small" type="button" id="share-copy">${t('copy')}</button></div>
      <div class="action-list">
        <a class="btn primary" id="share-wa" href="${wa}" target="_blank" rel="noopener noreferrer">${ICON.chat}${t('sendOnWhatsApp')}</a>
        ${navigator.share ? html`<button class="btn" type="button" id="share-native">${ICON.send}${t('shareOther')}</button>` : ''}
        ${email ? html`<a class="btn" href="mailto:${email}?body=${encodeURIComponent(text)}">${ICON.mail}${t('sendFromMyEmail')}</a>` : ''}
      </div>
      <p class="hint">${t('shareLinkWarning')}</p>`,
  });
  $('#share-copy', sheet).onclick = (e) => copyText(link, e.currentTarget);
  $('#share-url', sheet).onclick = (e) => e.target.select();
  $('#share-native', sheet)?.addEventListener('click', () => navigator.share({ text }).catch(() => {}));
  return sheet;
}
