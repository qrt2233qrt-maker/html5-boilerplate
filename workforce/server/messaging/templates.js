// Email and SMS text in Arabic and English. Each template returns
// { subject, body } for email or { body } for SMS.

const T = {
  en: {
    emailVerify: ({ name, code, link }) => ({
      subject: 'Confirm your email address',
      body: `Hello ${name},\n\nYour verification code is ${code}. It expires in 10 minutes.\n\nOr open this link: ${link}\n\nIf you didn't ask for this, you can ignore this email.`,
    }),
    phoneVerify: ({ code }) => ({ body: `Your verification code is ${code}. It expires in 10 minutes. Don't share it with anyone.` }),
    invitation: ({ name, business, role, link, days }) => ({
      subject: `You're invited to join ${business}`,
      body: `Hello ${name},\n\n${business} has invited you to join as ${role === 'manager' ? 'a manager' : 'an employee'}.\n\nSet up your account here: ${link}\n\nThis invitation expires in ${days} days.`,
    }),
    invitationSms: ({ business, link }) => ({ body: `${business} invited you to join. Set up your account: ${link}` }),
    resetEmail: ({ name, link }) => ({
      subject: 'Reset your password',
      body: `Hello ${name},\n\nUse this link to choose a new password. It expires in 30 minutes:\n${link}\n\nIf you didn't ask for this, you can ignore this email. Your password won't change.`,
    }),
    resetSms: ({ code }) => ({ body: `Your password reset code is ${code}. It expires in 10 minutes.` }),
    roleChanged: ({ name, business, role }) => ({
      subject: `Your role at ${business} has changed`,
      body: `Hello ${name},\n\nYour role at ${business} is now: ${role === 'manager' ? 'Manager' : 'Employee'}.`,
    }),
  },
  ar: {
    emailVerify: ({ name, code, link }) => ({
      subject: 'تأكيد بريدك الإلكتروني',
      body: `مرحباً ${name}،\n\nرمز التحقق الخاص بك هو ${code}، وينتهي خلال ١٠ دقائق.\n\nأو افتح هذا الرابط: ${link}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.`,
    }),
    phoneVerify: ({ code }) => ({ body: `رمز التحقق: ${code}. ينتهي خلال ١٠ دقائق. لا تشاركه مع أحد.` }),
    invitation: ({ name, business, role, link, days }) => ({
      subject: `دعوة للانضمام إلى ${business}`,
      body: `مرحباً ${name}،\n\nدعاك ${business} للانضمام ${role === 'manager' ? 'كمدير' : 'كموظف'}.\n\nأنشئ حسابك من هنا: ${link}\n\nتنتهي الدعوة خلال ${days} أيام.`,
    }),
    invitationSms: ({ business, link }) => ({ body: `دعاك ${business} للانضمام. أنشئ حسابك: ${link}` }),
    resetEmail: ({ name, link }) => ({
      subject: 'إعادة تعيين كلمة المرور',
      body: `مرحباً ${name}،\n\nاستخدم هذا الرابط لاختيار كلمة مرور جديدة، وينتهي خلال ٣٠ دقيقة:\n${link}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة ولن تتغير كلمة المرور.`,
    }),
    resetSms: ({ code }) => ({ body: `رمز إعادة تعيين كلمة المرور: ${code}. ينتهي خلال ١٠ دقائق.` }),
    roleChanged: ({ name, business, role }) => ({
      subject: `تغيّرت صلاحيتك في ${business}`,
      body: `مرحباً ${name}،\n\nصلاحيتك في ${business} الآن: ${role === 'manager' ? 'مدير' : 'موظف'}.`,
    }),
  },
};

export function render(template, locale, vars) {
  const lang = locale === 'en' ? 'en' : 'ar';
  return T[lang][template](vars);
}
