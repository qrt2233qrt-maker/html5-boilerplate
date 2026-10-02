// Reports (spec §27): view on screen, print to PDF, export CSV / Excel.
import { api, qs } from '../api.js';
import { LANG, t, tn } from '../i18n.js';
import { ICON } from '../icons.js';
import { S, bpath, can } from '../state.js';
import { dateShort, money, num } from '../fmt.js';
import { dateRangeBar, docUrl, empty, rangeState } from '../components.js';
import { busy, skeletonRows, toast, toastError } from '../ui.js';
import { $, html, mount } from '../util.js';

export const reportsPage = {
  title: () => t('reports'),
  async render(view, { query }) {
    const list = await api.get(bpath('/reports'));
    if (!list.length) return mount(view, empty(t('noReportsAvailable')));
    const type = list.find((r) => r.key === query.get('type'))?.key || list[0].key;
    const range = rangeState('reports');
    const f = { departmentId: '', membershipId: '', categoryId: '' };
    mount(view, html`<div class="toolbar no-print">
        <select class="input" id="type" aria-label="${t('report')}">${list.map((r) => html`<option value="${r.key}" ${r.key === type ? 'selected' : ''}>${r.title[LANG] || r.title.en}</option>`)}</select>
        <div id="range"></div><select class="input" id="dept" aria-label="${t('department')}"><option value="">${t('allDepartments')}</option></select>
        ${can('members.view') ? html`<select class="input" id="person" aria-label="${t('person')}"><option value="">${t('everyone')}</option></select>` : ''}
        <span class="spacer"></span>
        <button class="btn small" type="button" id="print">${ICON.print}${t('printPdf')}</button>
        ${can('reports.export') ? html`<button class="btn small" type="button" data-export="csv">${ICON.download}CSV</button><button class="btn small" type="button" data-export="xlsx">${ICON.download}Excel</button>` : ''}
      </div>
      <article class="report" id="report">${skeletonRows(8)}</article>`);
    $('#type', view).onchange = (e) => { location.hash = `#/reports?type=${e.target.value}`; };
    const [depts, members] = await Promise.all([api.get(bpath('/departments')), can('members.view') ? api.get(bpath('/members?limit=100')).then((r) => r.items) : []]);
    for (const d of depts.filter((x) => !x.archivedAt)) $('#dept', view).append(new Option(d.name, d.id));
    const person = $('#person', view);
    if (person) for (const m of members) person.append(new Option(m.name, m.membershipId));
    const load = async () => {
      const host = $('#report', view);
      mount(host, skeletonRows(8));
      try {
        const r = await api.get(bpath(`/reports/${type}${qs({ from: range.from, to: range.to, ...f })}`));
        if (!host.isConnected) return;
        const cell = (c, v) => (v === null || v === undefined || v === '' ? '—' : c.kind === 'money' ? money(v) : c.kind === 'number' ? num(v, 2) : c.kind === 'date' ? dateShort(v) : v);
        mount(host, html`<header class="report-head"><h2>${r.title[LANG] || r.title.en}</h2>
            <p class="muted"><bdi>${S.business.name}</bdi> · <bdi>${dateShort(r.from)} – ${dateShort(r.to)}</bdi></p></header>
          ${r.rows.length ? html`<div class="tablewrap"><table class="data"><thead><tr>${r.columns.map((c) => html`<th class="${c.kind === 'money' || c.kind === 'number' ? 'n' : ''}">${c.label[LANG] || c.label.en}</th>`)}</tr></thead>
            <tbody>${r.rows.map((row) => html`<tr>${r.columns.map((c) => html`<td class="${c.kind === 'money' || c.kind === 'number' ? 'num n' : ''}">${cell(c, row[c.key])}</td>`)}</tr>`)}</tbody></table></div>
            <p class="muted small">${tn('rowsN', r.rows.length)} · ${t('generatedAt', { date: new Date().toLocaleString(LANG === 'ar' ? 'ar-IQ' : 'en-GB') })}</p>` : empty(t('noData'))}`);
      } catch (err) { toastError(err); }
    };
    dateRangeBar($('#range', view), 'reports', range, (r) => { Object.assign(range, r); load(); });
    $('#dept', view).onchange = (e) => { f.departmentId = e.target.value; load(); };
    if (person) person.onchange = (e) => { f.membershipId = e.target.value; load(); };
    $('#print', view).onclick = () => window.print();
    view.querySelectorAll('[data-export]').forEach((b) => {
      b.onclick = async () => {
        busy(b);
        try {
          const job = await api.post(bpath(`/reports/${type}/export`), { from: range.from, to: range.to, format: b.dataset.export, locale: LANG, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
          toast(t('preparingExport'));
          // The file is built in the background; check until it is ready.
          for (let i = 0; i < 60; i++) {
            await new Promise((r) => setTimeout(r, i < 5 ? 600 : 2000));
            const s = await api.get(bpath(`/report-exports/${job.id}`));
            if (s.status === 'done') {
              const a = document.createElement('a');
              a.href = docUrl(s.documentId, true);
              a.click();
              toast(t('exportReady'));
              break;
            }
            if (s.status === 'failed') { toast(s.error || t('e.server_error'), { error: true }); break; }
          }
        } catch (err) { toastError(err); } finally { busy(b, false); }
      };
    });
    load();
  },
};
