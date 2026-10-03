// Owner settings (spec §37).
import { api } from '../api.js';
import { LANG, t, tn } from '../i18n.js';
import { ICON } from '../icons.js';
import { S, bpath, can } from '../state.js';
import { money } from '../fmt.js';
import { empty, formSheet } from '../components.js';
import { busy, closeSheet, confirmDialog, skeletonRows, toast, toastError } from '../ui.js';
import { $, html, mount } from '../util.js';
import { canOpenDoor, clockError, position } from '../clock.js';
import { hoursSheet, typeName } from '../hours.js';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const dayName = (d) => new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-IQ' : 'en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + d)));

export const settingsPage = {
  title: () => t('settings'),
  async render(view) {
    mount(view, skeletonRows(8));
    const manage = can('business.settings.manage');
    const [info, depts, locs, ecats, rcats, members] = await Promise.all([
      api.get(bpath('/settings')), api.get(bpath('/departments')), api.get(bpath('/locations')),
      api.get(bpath('/categories/expense')), api.get(bpath('/categories/revenue')),
      can('members.view') ? api.get(bpath('/members?status=active&limit=100')).then((r) => r.items) : [],
    ]);
    if (!view.isConnected) return;
    const s = info.settings;
    const managers = members.filter((m) => m.role !== 'employee');
    const card = (id, title, desc, rows, action) => html`<section class="panel" id="${id}"><div class="panel-head"><h2>${title}</h2>${action || ''}</div>
      ${desc ? html`<p class="muted small">${desc}</p>` : ''}${rows}</section>`;
    const kv = (pairs) => html`<dl class="kv">${pairs.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
    const editBtn = (k) => (manage ? html`<button class="btn small" type="button" data-edit="${k}">${t('edit')}</button>` : '');
    const catList = (cats, type) => html`<div class="listbox">${cats.map((c) => html`<div class="row ${c.archivedAt ? 'muted' : ''}"><span class="avatar">${c.icon || '🏷️'}</span>
      <span class="mid"><span class="t1">${LANG === 'ar' ? c.nameAr : c.nameEn}</span><span class="t2">${t(`kind_${c.kind}`)}${c.employeeClaimable ? ` · ${t('claimable')}` : ''}${c.archivedAt ? ` · ${t('archived')}` : ''}</span></span>
      ${manage ? html`<button class="btn small ghost" type="button" data-cat="${type}:${c.id}">${t('edit')}</button>` : ''}</div>`)}</div>`;
    mount(view, html`
      <div class="cols"><div>
        ${card('biz', t('businessInfo'), '', kv([[t('businessName'), info.name], [t('timezone'), info.timezone], [t('currency'), `${info.currency} (${info.currencyExponent} ${t('decimals')})`]]), editBtn('biz'))}
        ${manage ? card('rest', t('restaurantSetup'), info.kind === 'restaurant' ? t('restaurantSetupDone') : t('restaurantSetupBody'), '',
          html`<button class="btn small ${info.kind === 'restaurant' ? '' : 'primary'}" type="button" id="rest-setup">${info.kind === 'restaurant' ? t('addMissing') : t('setUp')}</button>`) : ''}
        ${can('schedules.manage') ? card('hours', t('hoursAndShifts'), t('hoursAndShiftsBody'), kv([[t('openingHours'), `${(s.hours || {}).opensAt} – ${(s.hours || {}).closesAt}`],
          ...((s.hours || {}).shiftTypes || []).map((x) => [typeName(x), `${x.start} – ${x.end}`])]), html`<button class="btn small" type="button" id="edit-hours">${t('edit')}</button>`) : ''}
        ${card('sched', t('schedulingRules'), t('schedulingRulesBody'), kv([[t('maxWeeklyHours'), s.scheduling.maxWeeklyHours], [t('maxShiftHours'), s.scheduling.maxShiftHours], [t('minRestHours'), s.scheduling.minRestHours]]), editBtn('sched'))}
        ${card('pay', t('payrollSettings'), '', kv([[t('payFrequency'), t(`freq_${s.payroll.frequency}`)], [t('weekStartsOn'), dayName(s.payroll.weekStartsOn)], [t('overtimeAfter'), `${s.payroll.overtimeWeeklyHours} ${t('hoursShort')}`], [t('overtimeRate'), `×${s.payroll.overtimeMultiplier}`]]), editBtn('pay'))}
        ${card('appr', t('approvalRules'), t('approvalRulesBody'), kv([[t('ownerApprovalOver'), money(s.approvals.expenseOwnerOver)]]), editBtn('appr'))}
        ${card('zone', t('clockZone'), t('clockZoneBody'), kv([[t('requireZone'), s.attendance.requireZone ? t('on') : t('off')], [t('checkLocation'), s.attendance.checkLocation !== false ? t('on') : t('off')], [t('typedCode'), s.attendance.typedCode ? t('on') : t('off')], [t('locationsWithPosition'), String(locs.filter((l) => !l.archivedAt && l.latitude !== null).length)]]), editBtn('zone'))}
        ${card('alerts', t('alertThresholds'), t('alertThresholdsBody'), kv([[t('alert_payroll'), `${s.alerts.payrollIncreasePct}%`], [t('alert_category'), `${s.alerts.categoryIncreasePct}%`], [t('alert_revenue'), `${s.alerts.revenueDropPct}%`], [t('alert_overtime'), `${s.alerts.overtimeIncreasePct}%`], [t('alert_margin'), `${s.alerts.marginBelowPct}%`], [t('alert_large'), money(s.alerts.largeExpense)]]), editBtn('alerts'))}
        ${can('security.manage') ? card('sec', t('authSettings'), t('authSettingsBody'), kv([[t('requirePhone'), s.auth.requirePhoneVerification ? t('on') : t('off')]]), html`<button class="btn small" type="button" data-edit="sec">${t('edit')}</button>`) : ''}
      </div><div>
        ${card('depts', t('departments'), t('departmentsBody'), depts.length ? html`<div class="listbox">${depts.map((d) => html`<div class="row ${d.archivedAt ? 'muted' : ''}"><span class="mid"><span class="t1">${d.name}</span>
          <span class="t2">${d.managerName ? `${t('managedBy')} ${d.managerName}` : t('noManager')} · ${tn('peopleN', d.memberCount)}${d.archivedAt ? ` · ${t('archived')}` : ''}</span></span>
          ${can('departments.manage') ? html`<button class="btn small ghost" type="button" data-dept="${d.id}">${t('edit')}</button>` : ''}</div>`)}</div>` : empty(t('noDepartments')),
        can('departments.manage') ? html`<button class="btn small" type="button" data-dept="new">${ICON.plus}${t('add')}</button>` : '')}
        ${card('locs', t('locations'), '', locs.length ? html`<div class="listbox">${locs.map((l) => html`<div class="row ${l.archivedAt ? 'muted' : ''}"><span class="mid"><span class="t1">${l.name}</span><span class="t2">${l.address || ''}</span></span>
          ${can('schedules.manage') ? html`<button class="btn small ghost" type="button" data-loc="${l.id}">${t('edit')}</button>` : ''}</div>`)}</div>` : empty(t('noLocations')),
        can('schedules.manage') ? html`<button class="btn small" type="button" data-loc="new">${ICON.plus}${t('add')}</button>` : '')}
        ${card('ecat', t('expenseCategories'), t('expenseCategoriesBody'), catList(ecats, 'expense'), manage ? html`<button class="btn small" type="button" data-cat="expense:new">${ICON.plus}${t('add')}</button>` : '')}
        ${card('rcat', t('revenueCategories'), '', catList(rcats, 'revenue'), manage ? html`<button class="btn small" type="button" data-cat="revenue:new">${ICON.plus}${t('add')}</button>` : '')}
        ${card('more', t('moreSettings'), '', html`<div class="listbox">
          ${can('permissions.manage') ? html`<a class="row" href="#/permissions"><span class="mid"><span class="t1">${t('rolesPermissions')}</span></span><span class="chev">${ICON.chev}</span></a>` : ''}
          <a class="row" href="#/account"><span class="mid"><span class="t1">${t('notificationSettings')}</span></span><span class="chev">${ICON.chev}</span></a></div>`)}
        ${can('owners.manage') ? card('imp', t('importOldApp'), t('importOldAppBody'), html`<input type="file" accept=".csv,text/csv,application/json,.json" id="impfile" hidden><button class="btn" type="button" id="imp">${ICON.download}${t('chooseExportFile')}</button><p class="small" id="impres"></p>`) : ''}
      </div></div>`);
    $('#rest-setup', view)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn);
      try {
        const r = await api.post(bpath('/setup/restaurant'));
        S.settingsFor = null;
        toast(r.sections.length || r.expenseCategories || r.revenueCategories ? t('restaurantSetupAdded', { n: r.sections.length + r.expenseCategories + r.revenueCategories }) : t('restaurantSetupNothing'));
        settingsPage.render(view);
      } catch (err) { busy(btn, false); toastError(err); }
    });
    $('#edit-hours', view)?.addEventListener('click', () => hoursSheet(() => { S.settingsFor = null; settingsPage.render(view); }));
    const save = async (patch) => { await api.put(bpath('/settings'), patch); S.settingsFor = null; settingsPage.render(view); };
    const forms = {
      biz: () => formSheet({ title: t('businessInfo'), fields: [
        { name: 'name', label: t('businessName'), value: info.name, required: true },
        { name: 'timezone', label: t('timezone'), value: info.timezone, required: true, hint: 'Asia/Baghdad, Asia/Dubai…' },
        { name: 'currency', label: t('currency'), value: info.currency, required: true, hint: t('currencyHint') },
        { name: 'currencyExponent', label: t('decimals'), type: 'number', value: info.currencyExponent },
      ], onSubmit: (v) => save({ name: v.name, timezone: v.timezone, currency: v.currency.toUpperCase(), currencyExponent: v.currencyExponent }) }),
      sched: () => formSheet({ title: t('schedulingRules'), fields: [
        { name: 'maxWeeklyHours', label: t('maxWeeklyHours'), type: 'number', value: s.scheduling.maxWeeklyHours },
        { name: 'maxShiftHours', label: t('maxShiftHours'), type: 'number', value: s.scheduling.maxShiftHours },
        { name: 'minRestHours', label: t('minRestHours'), type: 'number', value: s.scheduling.minRestHours },
      ], onSubmit: (v) => save({ settings: { scheduling: v } }) }),
      pay: () => formSheet({ title: t('payrollSettings'), fields: [
        { name: 'frequency', label: t('payFrequency'), type: 'seg', value: s.payroll.frequency, options: ['daily', 'weekly', 'biweekly', 'monthly'].map((k) => [k, t(`freq_${k}`)]) },
        { name: 'weekStartsOn', label: t('weekStartsOn'), type: 'select', value: s.payroll.weekStartsOn, options: WEEKDAYS.map((d) => [d, dayName(d)]) },
        { name: 'overtimeWeeklyHours', label: t('overtimeAfter'), type: 'number', value: s.payroll.overtimeWeeklyHours },
        { name: 'overtimeMultiplier', label: t('overtimeRate'), type: 'text', value: s.payroll.overtimeMultiplier, attrs: 'inputmode="decimal"' },
      ], onSubmit: (v) => save({ settings: { payroll: { ...v, weekStartsOn: Number(v.weekStartsOn), overtimeMultiplier: Number(v.overtimeMultiplier) } } }) }),
      zone: () => formSheet({ title: t('clockZone'), intro: t('clockZoneBody'), fields: [
        { name: 'requireZone', label: t('requireZoneLong'), type: 'checkbox', value: s.attendance.requireZone },
        { name: 'checkLocation', label: t('checkLocationLong'), type: 'checkbox', value: s.attendance.checkLocation !== false },
        { name: 'typedCode', label: t('typedCodeLong'), type: 'checkbox', value: !!s.attendance.typedCode }],
        onSubmit: (v) => save({ settings: { attendance: v } }) }),
      appr: () => formSheet({ title: t('approvalRules'), fields: [{ name: 'expenseOwnerOver', label: t('ownerApprovalOver'), type: 'money', value: s.approvals.expenseOwnerOver, required: true }],
        onSubmit: (v) => save({ settings: { approvals: v } }) }),
      alerts: () => formSheet({ title: t('alertThresholds'), fields: [
        ...['payrollIncreasePct', 'categoryIncreasePct', 'revenueDropPct', 'overtimeIncreasePct', 'marginBelowPct'].map((k) => ({ name: k, label: `${t(`alertField_${k}`)} (%)`, type: 'number', value: s.alerts[k] })),
        { name: 'largeExpense', label: t('alert_large'), type: 'money', value: s.alerts.largeExpense },
      ], onSubmit: (v) => save({ settings: { alerts: v } }) }),
      sec: () => formSheet({ title: t('authSettings'), fields: [{ name: 'requirePhoneVerification', label: t('requirePhone'), type: 'checkbox', value: s.auth.requirePhoneVerification }],
        onSubmit: (v) => save({ settings: { auth: v } }) }),
    };
    view.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.edit) return forms[b.dataset.edit]();
      if (b.dataset.dept) {
        const d = depts.find((x) => x.id === b.dataset.dept);
        return formSheet({ title: d ? d.name : t('addDepartment'), fields: [
          { name: 'name', label: t('name'), value: d?.name || '', required: true },
          { name: 'managerId', label: t('departmentManager'), type: 'select', optional: true, value: d?.managerId || '', options: managers.map((m) => [m.membershipId, m.name]), hint: t('departmentManagerHint') },
          d ? { name: 'archived', label: t('archived'), type: 'checkbox', value: !!d.archivedAt } : null,
        ], onSubmit: async (v) => {
          const body = { name: v.name, managerId: v.managerId || null, ...(d ? { archived: v.archived } : {}) };
          if (d) await api.put(bpath(`/departments/${d.id}`), body); else await api.post(bpath('/departments'), body);
          settingsPage.render(view);
        } });
      }
      if (b.dataset.loc) {
        const l = locs.find((x) => x.id === b.dataset.loc);
        const sheet = formSheet({ title: l ? l.name : t('addLocation'), intro: t('zoneIntro'), fields: [
          { name: 'name', label: t('name'), value: l?.name || '', required: true },
          { name: 'address', label: t('address'), value: l?.address || '', optional: true },
          { name: 'latitude', label: t('latitude'), type: 'number', value: l?.latitude ?? '', optional: true, attrs: 'step="any" dir="ltr"' },
          { name: 'longitude', label: t('longitude'), type: 'number', value: l?.longitude ?? '', optional: true, attrs: 'step="any" dir="ltr"' },
          { name: 'radiusM', label: t('zoneRadius'), type: 'number', value: l?.radiusM ?? 100, hint: t('zoneRadiusHint'), attrs: 'min="20" max="2000" step="10"' },
          { name: 'doorMode', label: t('doorCodeType'), type: 'seg', full: true, value: l?.doorMode || 'screen', options: [['screen', t('doorMode_screen')], ['daily', t('doorMode_daily')]] },
          l ? { name: 'archived', label: t('archived'), type: 'checkbox', value: !!l.archivedAt } : null,
        ], onSubmit: async (v) => {
          const body = { name: v.name, address: v.address, latitude: v.latitude ?? null, longitude: v.longitude ?? null, radiusM: v.radiusM, doorMode: v.doorMode };
          if (l) await api.put(bpath(`/locations/${l.id}`), { ...body, archived: v.archived }); else await api.post(bpath('/locations'), body);
          settingsPage.render(view);
        } });
        // Stand inside the restaurant and tap: fills in the position.
        const latField = sheet.querySelector('#f-latitude')?.closest('.field');
        latField?.insertAdjacentHTML('beforebegin', `<div class="field full"><button class="btn small" type="button" id="here">${t('useMyLocation')}</button>
          <span class="hint" id="here-msg">${t('useMyLocationHint')}</span></div>`);
        sheet.querySelector('#here')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const msg = sheet.querySelector('#here-msg');
          busy(btn);
          try {
            const p = await position();
            sheet.querySelector('#f-latitude').value = p.lat.toFixed(6);
            sheet.querySelector('#f-longitude').value = p.lng.toFixed(6);
            msg.textContent = t('positionSet', { m: Math.round(p.accuracy) });
          } catch (err) { msg.textContent = clockError(err); }
          busy(btn, false);
        });
        if (l && !l.archivedAt) {
          sheet.querySelector('.sfoot').insertAdjacentHTML('afterbegin', `${canOpenDoor() ? `<a class="btn" href="#/door?l=${l.id}">${t('openDoorScreen')}</a>` : ''}
            <button class="btn ghost" type="button" id="reset-door">${t('resetDoorCode')}</button>`);
          sheet.querySelector('#reset-door').onclick = async () => {
            if (!(await confirmDialog({ title: t('resetDoorCodeQ'), body: t('resetDoorCodeBody'), confirm: t('resetDoorCode') }))) return;
            await api.post(bpath(`/locations/${l.id}/door/reset`));
            toast(t('doorCodeReset'));
          };
          sheet.querySelector('.sfoot a')?.addEventListener('click', () => closeSheet());
        }
        return sheet;
      }
      if (b.dataset.cat) {
        const [type, id] = b.dataset.cat.split(':');
        const c = (type === 'expense' ? ecats : rcats).find((x) => x.id === id);
        const kinds = type === 'expense' ? ['fixed', 'operating', 'payroll', 'other'] : ['sale', 'service', 'other', 'refund', 'adjustment'];
        return formSheet({ title: c ? (LANG === 'ar' ? c.nameAr : c.nameEn) : t('addCategory'), fields: [
          { name: 'nameAr', label: t('nameAr'), value: c?.nameAr || '', required: true, attrs: 'dir="rtl"' },
          { name: 'nameEn', label: t('nameEn'), value: c?.nameEn || '', required: true, attrs: 'dir="ltr"' },
          c?.builtin ? null : { name: 'kind', label: t('type'), type: 'select', value: c?.kind || kinds[1], options: kinds.map((k) => [k, t(`kind_${k}`)]) },
          type === 'expense' ? { name: 'icon', label: t('icon'), value: c?.icon || '🏷️', optional: true } : null,
          type === 'expense' ? { name: 'employeeClaimable', label: t('claimableLong'), type: 'checkbox', value: !!c?.employeeClaimable } : null,
          c ? { name: 'archived', label: t('archived'), type: 'checkbox', value: !!c.archivedAt } : null,
        ], onSubmit: async (v) => {
          for (const k of Object.keys(v)) if (v[k] === null || v[k] === undefined) delete v[k];
          if (c) await api.put(bpath(`/categories/${type}/${c.id}`), v); else await api.post(bpath(`/categories/${type}`), v);
          settingsPage.render(view);
        } });
      }
      if (b.id === 'imp') $('#impfile', view).click();
    };
    const file = $('#impfile', view);
    if (file) file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      const btn = $('#imp', view);
      busy(btn);
      try {
        // The app's "Export CSV" file, or a full JSON export.
        const text = await f.text();
        const data = /^\s*[[{]/.test(text) ? JSON.parse(text) : { csv: text };
        const r = await api.post(bpath('/import/expenses-app'), data);
        mount($('#impres', view), html`${t('importResult', { n: r.imported, s: r.salaries, skipped: r.skippedRejected, again: r.alreadyImported })}`);
        toast(t('importDone'));
      } catch (err) {
        if (err instanceof SyntaxError) toast(t('importBadFile'), { error: true }); else toastError(err);
      } finally { busy(btn, false); }
    };
  },
};
