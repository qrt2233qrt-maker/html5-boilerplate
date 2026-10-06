// My work expenses (spec §7): add, follow status, fix and resubmit.
import { api } from '../api.js';
import { LANG, t } from '../i18n.js';
import { ICON } from '../icons.js';
import { bpath } from '../state.js';
import { dateShort, money, todayLocal } from '../fmt.js';
import { docUrl, empty, formSheet, statusPill } from '../components.js';
import { confirmDialog, openSheet, skeletonRows, toast } from '../ui.js';
import { $, html, mount } from '../util.js';

const catName = (c) => (LANG === 'ar' ? c.nameAr || c.categoryAr : c.nameEn || c.categoryEn);

export const expensesPage = {
  title: () => t('myExpenses'),
  async render(view, { query }) {
    mount(view, html`<div class="toolbar"><span class="spacer"></span><button class="btn primary" type="button" id="add">${ICON.plus}${t('addExpense')}</button></div>
      <div id="sum"></div><div id="list">${skeletonRows(5)}</div>`);
    const [items, cats] = await Promise.all([api.get(bpath('/employee-expenses?mine=true')), api.get(bpath('/categories/expense'))]);
    if (!view.isConnected) return;
    const claimable = cats.filter((c) => c.employeeClaimable && !c.archivedAt);
    const sumBy = (st) => items.filter((i) => st.includes(i.status)).reduce((a, i) => a + i.amount, 0);
    mount($('#sum', view), html`<div class="kpis small">
      <div class="kpi"><small>${t('waitingApproval')}</small><b class="num">${money(sumBy(['submitted', 'under_review']))}</b></div>
      <div class="kpi"><small>${t('approvedToRepay')}</small><b class="num">${money(sumBy(['approved']))}</b></div>
      <div class="kpi"><small>${t('st_reimbursed')}</small><b class="num">${money(sumBy(['reimbursed']))}</b></div></div>`);
    mount($('#list', view), items.length ? html`<div class="listbox">${items.map((e) => html`<button class="row" type="button" data-e="${e.id}">
      <span class="avatar">${e.icon || '🧾'}</span><span class="mid"><span class="t1">${e.description}</span>
        <span class="t2">${catName(e)} · ${dateShort(e.spentOn)}${e.receiptDocumentId ? ' · 📎' : ''}</span>
        ${e.status === 'rejected' && e.rejectionReason ? html`<span class="t2 bad">“${e.rejectionReason}”</span>` : ''}</span>
      <span class="end"><b class="num">${money(e.amount)}</b>${statusPill(e.status)}</span></button>`)}</div>`
      : empty(t('noExpensesYet'), t('noExpensesYetBody')));
    const open = (e) => expenseSheet(view, claimable, e);
    $('#add', view).onclick = () => open(null);
    $('#list', view).onclick = (ev) => { const b = ev.target.closest('[data-e]'); if (b) detail(view, claimable, items.find((x) => x.id === b.dataset.e)); };
    if (query.get('new') === '1') open(null);
  },
};

function expenseSheet(view, cats, e) {
  formSheet({
    title: e ? t('editExpense') : t('addExpense'), submitLabel: t('submitForApproval'),
    extraFoot: html`<button class="btn" type="submit" form="fs-form" name="draft" value="1" data-draft>${t('saveDraft')}</button>`,
    fields: [
      { name: 'amount', label: t('amount'), type: 'money', required: true, value: e?.amount },
      { name: 'spentOn', label: t('date'), type: 'date', required: true, value: e?.spentOn?.slice(0, 10) || todayLocal(), attrs: `max="${todayLocal()}"` },
      { name: 'categoryId', label: t('category'), type: 'seg', full: true, value: e?.categoryId || '', options: cats.map((c) => [c.id, `${c.icon || ''} ${catName(c)}`]) },
      { name: 'description', label: t('description'), type: 'text', required: true, value: e?.description || '' },
      { name: 'businessPurpose', label: t('businessPurpose'), type: 'text', optional: true, value: e?.businessPurpose || '' },
      { name: 'location', label: t('location'), type: 'text', optional: true, value: e?.location || '' },
      { name: 'receiptDocumentId', label: t('receipt'), type: 'file', optional: true, capture: true, value: e?.receiptDocumentId || '' },
    ],
    onSubmit: async (v, btn, form) => {
      if (!v.categoryId) { form.querySelector('#err-categoryId').textContent = t('e.required'); return false; }
      const submit = !form.dataset.draft;
      const body = { amount: v.amount, spentOn: v.spentOn, categoryId: v.categoryId, description: v.description, businessPurpose: v.businessPurpose, location: v.location, receiptDocumentId: v.receiptDocumentId || null, submit };
      if (e) await api.put(bpath(`/employee-expenses/${e.id}`), body);
      else await api.post(bpath('/employee-expenses'), body);
      toast(submit ? t('expenseSubmitted') : t('draftSaved'));
      expensesPage.render(view, { query: new URLSearchParams() });
    },
  });
  // "Save draft" marks the form before the shared submit handler runs.
  const form = document.getElementById('fs-form');
  document.querySelector('[data-draft]').addEventListener('click', () => { form.dataset.draft = '1'; });
  document.querySelector('#sheet .sfoot .primary')?.addEventListener('click', () => { delete form.dataset.draft; });
}

async function detail(view, cats, e) {
  const full = await api.get(bpath(`/employee-expenses/${e.id}`));
  const editable = ['draft', 'rejected'].includes(full.status);
  const sheet = openSheet({
    title: full.description,
    body: html`<p class="lead num">${money(full.amount)}</p><div class="row-gap">${statusPill(full.status)}${full.needsOwner ? html`<span class="pill">${t('needsOwner')}</span>` : ''}</div>
      <dl class="kv panel"><dt>${t('date')}</dt><dd>${dateShort(full.spentOn)}</dd><dt>${t('category')}</dt><dd>${catName(full)}</dd>
        ${full.businessPurpose ? html`<dt>${t('businessPurpose')}</dt><dd>${full.businessPurpose}</dd>` : ''}${full.location ? html`<dt>${t('location')}</dt><dd>${full.location}</dd>` : ''}
        ${full.receiptDocumentId ? html`<dt>${t('receipt')}</dt><dd><a href="${docUrl(full.receiptDocumentId)}" target="_blank" rel="noopener">${t('viewReceipt')}</a></dd>` : ''}
        ${full.rejectionReason ? html`<dt>${t('reason')}</dt><dd>${full.rejectionReason}</dd>` : ''}</dl>
      <h3 class="h2 small">${t('history')}</h3><ol class="timeline">${full.approvals.map((a) => html`<li><b>${t(`dec_${a.decision}`)}</b><span class="muted small">${a.by} · ${dateShort(a.createdAt)}</span>${a.note ? html`<span class="small">“${a.note}”</span>` : ''}</li>`)}</ol>`,
    foot: editable ? html`${full.status === 'draft' ? html`<button class="btn danger" type="button" data-del>${t('delete')}</button>` : ''}<button class="btn primary" type="button" data-edit>${full.status === 'rejected' ? t('fixResubmit') : t('edit')}</button>` : '',
  });
  sheet.querySelector('[data-edit]')?.addEventListener('click', () => expenseSheet(view, cats, full));
  sheet.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: t('deleteDraftQ'), confirm: t('delete'), danger: true }))) return;
    await api.del(bpath(`/employee-expenses/${full.id}`));
    sheet.close();
    expensesPage.render(view, { query: new URLSearchParams() });
  });
}
