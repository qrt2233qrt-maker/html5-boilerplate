// Short Arabic/English titles for notification emails and SMS. The app
// shows richer text for the same types (web/js/i18n.js).
const T = {
  'invitation.accepted': ['{name} accepted your invitation', 'قبل {name} دعوتك'],
  'role.changed': ['Your role has changed', 'تغيّر دورك'],
  'member.suspended': ['Your access has been suspended', 'أُوقف وصولك'],
  'member.active': ['Your access has been restored', 'أُعيد وصولك'],
  'shift.assigned': ['You have a new shift', 'لديك مناوبة جديدة'],
  'shift.changed': ['One of your shifts changed', 'تغيّرت إحدى مناوباتك'],
  'shift.cancelled': ['One of your shifts was cancelled', 'أُلغيت إحدى مناوباتك'],
  'schedule.published': ['Your new schedule is ready', 'جدولك الجديد جاهز'],
  'shift.offered': ['A colleague offered you a shift', 'عرض عليك زميل مناوبة'],
  'shift.offer_taken': ['Someone took the shift you offered', 'أخذ أحدهم المناوبة التي عرضتها'],
  'request.new': ['A shift request needs your review', 'طلب مناوبة بانتظار مراجعتك'],
  'request.approved': ['Your shift request was approved', 'تمت الموافقة على طلب المناوبة'],
  'request.rejected': ['Your shift request was declined', 'رُفض طلب المناوبة'],
  'time_off.approved': ['Your time off was approved', 'تمت الموافقة على إجازتك'],
  'time_off.rejected': ['Your time off was declined', 'رُفض طلب إجازتك'],
  'swap.requested': ['A colleague wants to swap shifts with you', 'يريد زميل تبديل مناوبة معك'],
  'swap.accepted': ['Your swap was accepted and is waiting for approval', 'قُبل التبديل وهو بانتظار الموافقة'],
  'swap.awaiting_approval': ['A shift swap needs your approval', 'تبديل مناوبة بانتظار موافقتك'],
  'swap.approved': ['Your shift swap was approved', 'تمت الموافقة على تبديل المناوبة'],
  'swap.rejected': ['Your shift swap was declined', 'رُفض تبديل المناوبة'],
  'swap.cancelled': ['A shift swap was cancelled', 'أُلغي تبديل مناوبة'],
  'expense.submitted': ['An expense is waiting for review', 'مصروف بانتظار المراجعة'],
  'expense.owner_approval': ['A large expense needs your approval', 'مصروف كبير بانتظار موافقتك'],
  'expense.approved': ['Your expense was approved', 'تمت الموافقة على مصروفك'],
  'expense.rejected': ['Your expense was declined', 'رُفض مصروفك'],
  'expense.reimbursed': ['Your expense was paid back', 'تم تعويض مصروفك'],
  'finance.large_expense': ['A large expense was recorded', 'سُجّل مصروف كبير'],
  'salary.pending': ['Your pay for this period is ready', 'راتب هذه الفترة جاهز'],
  'salary.paid': ['Your pay has been paid', 'تم دفع راتبك'],
  'salary.correcting': ['Your pay for a period is being corrected', 'يجري تصحيح راتبك لإحدى الفترات'],
  'salary.advance': ['An advance on your pay was recorded', 'سُجّلت سلفة على راتبك'],
  'alert.payroll_increase': ['Payroll is up {pct}% on last month', 'ارتفعت الرواتب {pct}% عن الشهر الماضي'],
  'alert.revenue_drop': ['Revenue is down {pct}% on last month', 'انخفضت الإيرادات {pct}% عن الشهر الماضي'],
  'alert.category_increase': ['{nameEn} spending is up {pct}%', 'ارتفع إنفاق {nameAr} بنسبة {pct}%'],
  'alert.overtime_increase': ['Overtime is up {pct}%', 'ارتفع العمل الإضافي {pct}%'],
  'alert.margin_low': ['Profit margin fell to {margin}%', 'انخفض هامش الربح إلى {margin}%'],
  'alert.budget_over': ['A budget has been exceeded', 'تم تجاوز ميزانية'],
  'alert.budget_near': ['A budget is {used}% used', 'استُخدم {used}% من ميزانية'],
};

// Sent by SMS too (when the person turned SMS on): time-sensitive only.
export const SMS_TYPES = new Set(['shift.assigned', 'shift.changed', 'shift.cancelled', 'swap.requested', 'swap.approved', 'swap.rejected',
  'time_off.approved', 'time_off.rejected', 'salary.paid']);

export function noticeTitle(type, locale, data = {}) {
  const pair = T[type];
  if (!pair) return null;
  let s = pair[locale === 'en' ? 0 : 1];
  for (const [k, v] of Object.entries(data)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
