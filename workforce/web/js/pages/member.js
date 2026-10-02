// Full employee profile (spec §15, §19-21): details, pay history, shifts,
// attendance, expenses, documents and the employment lifecycle.
import { api } from '../api.js';
import { t } from '../i18n.js';
import { ICON } from '../icons.js';
import { S, bpath, can, isOwner } from '../state.js';
import { addDays, dateShort, dayLabel, money, num, time, todayLocal } from '../fmt.js';
import { docUrl, empty, formSheet, statusPill, uploadFile } from '../components.js';
import { busy, skeletonRows, toast, toastError } from '../ui.js';
import { $, html, initials, mount } from '../util.js';

export const memberPage = {
  title: () => t('profile'),
  async render(view, { query }) {
    const id = query.get('id');
    const tab = query.get('tab') || 'overview';
    mount(view, skeletonRows(6));
    let m;
    try { m = await api.get(bpath(`/members/${id}`)); } catch (err) { toastError(err); return; }
    if (!view.isConnected) return;
    const self = id === S.business.membershipId;
    const sensitive = m.sensitive !== undefined;
    const tabs = [
      ['overview', t('overview')],
      (self || can('members.view_sensitive') || can('payroll.view')) && ['pay', t('pay')],
      (self || can('schedules.view')) && ['shifts', t('shifts')],
      (self || can('attendance.view')) && ['attendance', t('attendance')],
      (self || can('employee_expenses.review')) && ['expenses', t('expenses')],
      (self || can('members.view_sensitive')) && ['documents', t('documents')],
    ].filter(Boolean);
    const editable = m.role !== 'owner' || isOwner();
    const lifecycle = !self && m.role !== 'owner' && (isOwner() || m.role === 'employee');
    mount(view, html`<p><a href="#/team">← ${t('team')}</a></p>
      <section class="profile-top"><span class="avatar lg">${initials(m.name)}</span>
        <div class="grow"><h2>${m.name}</h2><p class="muted">${[m.profile.jobTitle, m.departmentName, t(`role_${m.role}`)].filter(Boolean).join(' · ')}</p>
          <div class="row-gap">${statusPill(m.status === 'active' ? 'approved' : m.status === 'suspended' ? 'review' : 'cancelled')}<span class="muted small">${t(`status_${m.status}`)}</span></div></div>
        <div class="row-gap">${m.phone ? html`<a class="btn small" href="tel:${m.phone}">${ICON.phone}</a>` : ''}${m.email ? html`<a class="btn small" href="mailto:${m.email}">${ICON.mail}</a>` : ''}</div></section>
      <div class="tabbar" role="tablist">${tabs.map(([k, l]) => html`<a role="tab" class="tabbtn" href="#/member?id=${id}&tab=${k}" aria-selected="${k === tab}">${l}</a>`)}</div>
      <div id="tab">${skeletonRows(4)}</div>
      ${lifecycle && (can('members.terminate') || can('records.hard_delete')) ? html`<section class="panel danger-zone"><h2>${t('employment')}</h2><div class="row-gap">
        ${can('members.terminate') && ['active', 'suspended'].includes(m.status) ? html`<button class="btn danger" type="button" data-life="terminate">${t('terminate')}</button>` : ''}
        ${can('members.terminate') && m.status === 'terminated' ? html`<button class="btn" type="button" data-life="archive">${t('archive')}</button>` : ''}
        ${isOwner() && ['terminated', 'archived'].includes(m.status) ? html`<button class="btn" type="button" data-life="reinstate">${t('reinstate')}</button>` : ''}
        ${can('records.hard_delete') && m.status === 'archived' ? html`<button class="btn danger" type="button" data-life="delete">${t('deletePermanently')}</button>` : ''}
      </div>${m.endDate ? html`<p class="small muted">${t('endedOn', { date: dateShort(m.endDate) })}${m.terminationReason ? ` · ${m.terminationReason}` : ''}</p>` : ''}</section>` : ''}`);
    const host = $('#tab', view);
    const reload = () => memberPage.render(view, { query });
    view.querySelectorAll('[data-life]').forEach((b) => { b.onclick = () => lifecycleAction(b.dataset.life, m, reload); });
    try {
      if (tab === 'overview') overview(host, m, { self, sensitive, editable, reload });
      if (tab === 'pay') await payTab(host, m, self, reload);
      if (tab === 'shifts') await shiftsTab(host, m, self);
      if (tab === 'attendance') await attendanceTab(host, m, self);
      if (tab === 'expenses') await expensesTab(host, m, self);
      if (tab === 'documents') await documentsTab(host, m, self, reload);
    } catch (err) { toastError(err); }
  },
};

function overview(host, m, { self, sensitive, editable, reload }) {
  const p = m.profile;
  const s = m.sensitive || {};
  const canEdit = editable && can('members.edit');
  mount(host, html`<div class="cols"><section class="panel"><div class="panel-head"><h2>${t('employmentDetails')}</h2>
      ${canEdit ? html`<button class="btn small" type="button" id="edit">${t('edit')}</button>` : ''}</div>
      <dl class="kv">${[[t('employeeNumber'), p.employeeNumber], [t('jobTitle'), p.jobTitle], [t('department'), m.departmentName], [t('reportsTo'), m.reportsToName],
        [t('startDate'), p.startDate && dateShort(p.startDate)], [t('email'), m.email], [t('phone'), m.phone], [t('workPhone'), p.workPhone],
        [t('payRate'), m.pay ? `${money(m.pay.rate)} ${t(m.pay.payType === 'hourly' ? 'perHour' : 'perMonth')}` : null], [t('notes'), p.notes]]
    .filter(([, v]) => v).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl></section>
    ${sensitive ? html`<section class="panel"><div class="panel-head"><h2>${ICON.lock} ${t('personalDetails')}</h2>
      ${self || canEdit ? html`<button class="btn small" type="button" id="editp">${t('edit')}</button>` : ''}</div>
      <p class="hint">${t('personalDetailsHint')}</p>
      <dl class="kv">${[[t('emergencyName'), s.emergencyName], [t('emergencyRelation'), s.emergencyRelation], [t('emergencyPhone'), s.emergencyPhone],
        [t('nationalId'), s.nationalId], [t('address'), s.address], [t('birthDate'), s.birthDate && dateShort(s.birthDate)]]
    .map(([k, v]) => html`<dt>${k}</dt><dd>${v || '—'}</dd>`)}</dl></section>` : ''}</div>`);
  $('#edit', host)?.addEventListener('click', async () => {
    const [depts, members] = await Promise.all([api.get(bpath('/departments')), api.get(bpath('/members?status=active&limit=100')).then((r) => r.items)]);
    formSheet({
      title: t('editProfile'),
      fields: [
        { name: 'employeeNumber', label: t('employeeNumber'), value: p.employeeNumber || '', optional: true },
        { name: 'jobTitle', label: t('jobTitle'), value: p.jobTitle || '', optional: true },
        { name: 'departmentId', label: t('department'), type: 'select', optional: true, value: m.departmentId || '', options: depts.filter((d) => !d.archivedAt).map((d) => [d.id, d.name]) },
        { name: 'reportsTo', label: t('reportsTo'), type: 'select', optional: true, value: m.reportsTo || '', options: members.filter((x) => x.role !== 'employee' && x.membershipId !== m.membershipId).map((x) => [x.membershipId, x.name]) },
        { name: 'startDate', label: t('startDate'), type: 'date', optional: true, value: p.startDate || '' },
        { name: 'workPhone', label: t('workPhone'), type: 'tel', optional: true, value: p.workPhone || '' },
        { name: 'notes', label: t('notes'), type: 'textarea', optional: true, value: p.notes || '', full: true },
      ],
      onSubmit: async (v) => {
        await api.put(bpath(`/members/${m.membershipId}`), {
          profile: { employeeNumber: v.employeeNumber, jobTitle: v.jobTitle, startDate: v.startDate, workPhone: v.workPhone, notes: v.notes },
          departmentId: v.departmentId || null, reportsTo: v.reportsTo || null,
        });
        reload();
      },
    });
  });
  $('#editp', host)?.addEventListener('click', () => formSheet({
    title: t('personalDetails'),
    fields: [
      { name: 'emergencyName', label: t('emergencyName'), value: s.emergencyName || '', optional: true },
      { name: 'emergencyRelation', label: t('emergencyRelation'), value: s.emergencyRelation || '', optional: true },
      { name: 'emergencyPhone', label: t('emergencyPhone'), type: 'tel', value: s.emergencyPhone || '', optional: true, attrs: 'dir="ltr"' },
      { name: 'nationalId', label: t('nationalId'), value: s.nationalId || '', optional: true },
      { name: 'address', label: t('address'), value: s.address || '', optional: true },
      { name: 'birthDate', label: t('birthDate'), type: 'date', value: s.birthDate || '', optional: true },
    ],
    onSubmit: async (v) => { await api.put(bpath(`/members/${m.membershipId}`), { sensitive: v }); reload(); },
  }));
}

async function payTab(host, m, self, reload) {
  const [rates, pay] = await Promise.all([
    api.get(bpath(`/members/${m.membershipId}/pay-rates`)),
    self ? api.get(bpath('/me/pay')) : can('payroll.view') ? api.get(bpath(`/members/${m.membershipId}/pay`)) : null,
  ]);
  mount(host, html`<section class="panel"><div class="panel-head"><h2>${t('payRateHistory')}</h2>
      ${can('payroll.manage') && !self ? html`<button class="btn small primary" type="button" id="addrate">${t('changePay')}</button>` : ''}</div>
    ${rates.length ? html`<div class="listbox">${rates.map((r, i) => html`<div class="row"><span class="mid"><span class="t1 num">${money(r.rate)} ${t(r.payType === 'hourly' ? 'perHour' : 'perMonth')}</span>
      <span class="t2">${t('fromDate', { date: dateShort(r.effectiveFrom) })}${r.note ? ` · ${r.note}` : ''}${r.createdBy ? ` · ${r.createdBy}` : ''}</span></span>${i === 0 ? html`<span class="pill ok">${t('current')}</span>` : ''}</div>`)}</div>` : empty(t('noPayRate'))}</section>
    ${pay ? html`<section class="panel"><h2>${t('payHistory')}</h2>${pay.history.length ? html`<div class="tablewrap"><table class="data"><thead><tr><th>${t('period')}</th><th>${t('hoursCol')}</th><th>${t('gross')}</th><th>${t('net')}</th><th>${t('status')}</th></tr></thead>
      <tbody>${pay.history.map((h) => html`<tr><td>${dateShort(h.periodStart)} – ${dateShort(h.periodEnd)}</td><td class="num">${num(h.hours)}</td><td class="num">${money(h.gross)}</td><td class="num">${money(h.net)}</td><td>${statusPill(h.status)}</td></tr>`)}</tbody></table></div>` : empty(t('noPayYet'))}</section>` : ''}`);
  $('#addrate', host)?.addEventListener('click', () => formSheet({
    title: t('changePay'), intro: t('changePayBody'),
    fields: [
      { name: 'payType', label: t('payType'), type: 'seg', value: rates[0]?.payType || 'salaried', options: [['hourly', t('pay_hourly')], ['salaried', t('pay_salaried')]] },
      { name: 'rate', label: t('payRate'), type: 'money', required: true, hint: t('payRateHint') },
      { name: 'effectiveFrom', label: t('effectiveFrom'), type: 'date', value: todayLocal(), required: true },
      { name: 'note', label: t('reason'), type: 'text', optional: true },
    ],
    onSubmit: async (v) => { await api.post(bpath(`/members/${m.membershipId}/pay-rates`), { ...v, note: v.note || null }); reload(); },
  }));
}

async function shiftsTab(host, m, self) {
  const today = todayLocal();
  const q = `from=${addDays(today, -30)}&to=${addDays(today, 30)}${self ? '&mine=true' : `&membershipId=${m.membershipId}`}`;
  const shifts = await api.get(bpath(`/shifts?${q}`));
  mount(host, shifts.length ? html`<div class="listbox">${shifts.reverse().map((s) => html`<a class="row" href="#/schedule?${self ? 'mine=1&' : ''}shift=${s.id}">
    <span class="mid"><span class="t1">${dayLabel(s.startsAt)}</span><span class="t2 num">${time(s.startsAt)} – ${time(s.endsAt)}</span></span>
    <span class="end">${s.rescheduled ? html`<span class="pill info">${t('st_rescheduled')}</span>` : ''}${statusPill(s.status)}</span></a>`)}</div>` : empty(t('noShifts')));
}

async function attendanceTab(host, m, self) {
  const today = todayLocal();
  const recs = await api.get(bpath(`/attendance?from=${addDays(today, -60)}&to=${today}${self ? '&mine=true' : `&membershipId=${m.membershipId}`}`));
  mount(host, recs.length ? html`<div class="tablewrap"><table class="data"><thead><tr><th>${t('date')}</th><th>${t('clockIn')}</th><th>${t('clockOut')}</th><th>${t('hoursCol')}</th><th>${t('late')}</th></tr></thead>
    <tbody>${recs.map((a) => html`<tr><td>${dayLabel(a.clockIn)}</td><td class="num">${time(a.clockIn)}</td><td class="num">${a.clockOut ? time(a.clockOut) : '—'}</td><td class="num">${a.hours === null ? '—' : num(a.hours)}</td><td class="num">${a.lateMinutes || '—'}</td></tr>`)}</tbody></table></div>` : empty(t('noAttendance')));
}

async function expensesTab(host, m, self) {
  const list = await api.get(bpath(`/employee-expenses?${self ? 'mine=true' : `membershipId=${m.membershipId}`}`));
  mount(host, list.length ? html`<div class="listbox">${list.map((e) => html`<div class="row"><span class="avatar">${e.icon || '🧾'}</span>
    <span class="mid"><span class="t1">${e.description}</span><span class="t2">${dateShort(e.spentOn)}</span></span>
    <span class="end"><b class="num">${money(e.amount)}</b>${statusPill(e.status)}</span></div>`)}</div>` : empty(t('noExpensesYet')));
}

async function documentsTab(host, m, self, reload) {
  const docs = await api.get(bpath(`/members/${m.membershipId}/documents`));
  const canUpload = self || can('members.edit');
  mount(host, html`<section class="panel"><div class="panel-head"><h2>${t('documents')}</h2>
      ${canUpload ? html`<button class="btn small" type="button" id="up">${ICON.plus}${t('uploadDocument')}</button><input type="file" id="file" hidden accept="image/*,application/pdf">` : ''}</div>
    <p class="hint">${t('documentsHint')}</p>
    ${docs.length ? html`<div class="listbox">${docs.map((d) => html`<div class="row"><span class="avatar">${ICON.file}</span>
      <span class="mid"><span class="t1">${d.filename}</span><span class="t2">${t(`doc_${d.kind}`)} · ${dateShort(d.created_at)} · ${num(d.size / 1024, 0)} KB</span></span>
      <a class="btn small ghost" href="${docUrl(d.id)}" target="_blank" rel="noopener">${t('open')}</a></div>`)}</div>` : empty(t('noDocuments'))}</section>`);
  const btn = $('#up', host);
  if (btn) {
    const input = $('#file', host);
    btn.onclick = () => input.click();
    input.onchange = async () => {
      if (!input.files[0]) return;
      busy(btn);
      try {
        await uploadFile(input.files[0], { kind: 'document', membershipId: m.membershipId });
        toast(t('uploaded'));
        reload();
      } catch (err) { busy(btn, false); toastError(err); }
    };
  }
}

// Termination keeps every record (spec §20); deletion is owner-only and needs the name typed (spec §21).
function lifecycleAction(action, m, reload) {
  const post = (path, body = {}) => api.post(bpath(`/members/${m.membershipId}/${path}`), body);
  if (action === 'terminate') {
    return formSheet({
      title: t('terminateQ', { name: m.name }), intro: t('terminateBody'), danger: true, submitLabel: t('terminate'),
      fields: [
        { name: 'endDate', label: t('lastWorkingDay'), type: 'date', value: todayLocal(), required: true },
        { name: 'reason', label: t('reason'), type: 'textarea', required: true, full: true },
        { name: 'confirm', label: t('terminateConfirm'), type: 'checkbox' },
      ],
      onSubmit: async (v, btn, form) => {
        if (!v.confirm) { form.querySelector('.form-error').textContent = t('tickToConfirm'); return false; }
        const r = await post('terminate', { endDate: v.endDate, reason: v.reason });
        toast(t('terminatedToast', { n: r.shiftsCancelled }));
        reload();
      },
    });
  }
  if (action === 'delete') {
    return formSheet({
      title: t('deletePermanentlyQ'), intro: t('deletePermanentlyBody', { name: m.name }), danger: true, submitLabel: t('deletePermanently'),
      fields: [{ name: 'confirm', label: t('typeName', { name: m.name }), required: true }, { name: 'reason', label: t('reason'), type: 'textarea', required: true, full: true }],
      onSubmit: async (v) => { await post('delete', v); toast(t('deleted')); location.hash = '#/team'; },
    });
  }
  const run = async () => {
    try { await post(action); toast(t('saved')); reload(); } catch (err) { toastError(err); }
  };
  return run();
}
