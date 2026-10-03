// Delivery trips (PizzaRita): managers enter how many trips each driver made
// each day; drivers are paid per trip in payroll.
import { api } from '../api.js';
import { t, tn } from '../i18n.js';
import { ICON } from '../icons.js';
import { bpath } from '../state.js';
import { addDays, dayLabel, money, num, todayLocal } from '../fmt.js';
import { empty } from '../components.js';
import { busy, skeletonRows, toast, toastError } from '../ui.js';
import { $, html, mount } from '../util.js';

export const tripsPage = {
  title: () => t('deliveryTrips'),
  async render(view, { query }) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(query.get('day') || '') ? query.get('day') : todayLocal();
    mount(view, html`<div class="toolbar"><div class="weeknav">
        <a class="iconbtn" href="#/trips?day=${addDays(day, -1)}" aria-label="${t('previousDay')}"><span class="flip">${ICON.chev}</span></a>
        <input class="input" type="date" id="day" value="${day}" max="${todayLocal()}" aria-label="${t('date')}">
        <a class="iconbtn" href="#/trips?day=${addDays(day, 1)}" aria-label="${t('nextDay')}">${ICON.chev}</a></div>
        ${day !== todayLocal() ? html`<a class="btn small ghost" href="#/trips">${t('today')}</a>` : ''}</div>
      <div id="body">${skeletonRows(4)}</div>`);
    $('#day', view).onchange = (e) => { location.hash = `#/trips?day=${e.target.value}`; };
    const from = addDays(day, -6);
    const data = await api.get(bpath(`/trips?from=${from}&to=${day}`));
    if (!view.isConnected) return;
    const body = $('#body', view);
    if (!data.drivers.length) return mount(body, empty(t('noDrivers'), t('noDriversBody')));
    const on = (id, d) => data.entries.find((e) => e.membershipId === id && e.day === d);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    mount(body, html`<section class="panel"><h2>${dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        <form id="trips-form" novalidate><div class="listbox">${data.drivers.map((d) => {
          const e = on(d.membershipId, day);
          return html`<div class="row trip-row"><span class="avatar sm">${ICON.scooter}</span>
            <span class="mid"><span class="t1">${d.name}</span><span class="t2 num">${d.pay ? `${money(d.pay.rate)} ${t('perTrip')}` : ''}${e?.paid ? ` · ${t('st_paid')}` : ''}</span></span>
            <span class="stepper" data-id="${d.membershipId}">
              <button class="iconbtn" type="button" data-step="-1" aria-label="${t('fewerTrips')}" ${e?.paid ? 'disabled' : ''}>−</button>
              <input class="input num" type="number" min="0" max="500" inputmode="numeric" name="t-${d.membershipId}" value="${e ? e.trips : ''}" placeholder="0" aria-label="${t('tripsFor', { name: d.name })}" ${e?.paid ? 'disabled' : ''}>
              <button class="iconbtn" type="button" data-step="1" aria-label="${t('moreTrips')}" ${e?.paid ? 'disabled' : ''}>+</button></span></div>`;
        })}</div>
        <p class="hint" id="trip-total"></p>
        <button class="btn primary block" type="submit">${t('saveTrips')}</button></form></section>
      <section class="panel"><h2>${t('last7Days')}</h2><div class="tablewrap"><table class="data"><thead><tr><th>${t('driver')}</th>
        ${days.map((d) => html`<th class="n">${dayLabel(d, { weekday: 'short', day: 'numeric' })}</th>`)}<th class="n">${t('total')}</th><th class="n">${t('pay')}</th></tr></thead>
        <tbody>${data.drivers.map((d) => {
          const counts = days.map((x) => on(d.membershipId, x)?.trips ?? 0);
          const sum = counts.reduce((a, b) => a + b, 0);
          return html`<tr><td>${d.name}</td>${counts.map((c) => html`<td class="num n">${c || '·'}</td>`)}<td class="num n"><b>${num(sum, 0)}</b></td>
            <td class="num n">${d.pay ? money(sum * d.pay.rate) : '—'}</td></tr>`;
        })}</tbody></table></div><p class="hint">${t('tripsPayNote')}</p></section>`);
    const form = $('#trips-form', view);
    const total = () => {
      let n = 0; let amount = 0;
      for (const d of data.drivers) { const v = Number(form.elements[`t-${d.membershipId}`].value || 0); n += v; amount += v * (d.pay?.rate || 0); }
      $('#trip-total', view).textContent = `${tn('tripsN', n)} · ${money(amount)}`;
    };
    total();
    form.oninput = total;
    form.onclick = (e) => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      const input = b.parentElement.querySelector('input');
      input.value = String(Math.max(0, Math.min(500, Number(input.value || 0) + Number(b.dataset.step))));
      total();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      const entries = data.drivers
        .filter((d) => !on(d.membershipId, day)?.paid)
        .map((d) => ({ membershipId: d.membershipId, raw: form.elements[`t-${d.membershipId}`].value }))
        .filter((x) => x.raw !== '' || on(x.membershipId, day))
        .map((x) => ({ membershipId: x.membershipId, trips: Number(x.raw || 0) }));
      busy(btn);
      try {
        const r = await api.put(bpath('/trips'), { day, entries });
        toast(r.saved ? t('tripsSaved') : t('noChanges'));
        tripsPage.render(view, { query: new URLSearchParams(`day=${day}`) });
      } catch (err) { busy(btn, false); toastError(err); }
    };
  },
};
