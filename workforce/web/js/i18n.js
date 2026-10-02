// Arabic and English text for the whole app. Arabic is the default because
// the existing users work in Arabic; the choice is remembered per device.
import { LS } from './util.js';
import { en as enOps, ar as arOps } from './strings.js';

const en = {
  appName: 'Workforce',
  tagline: 'Schedules, pay, expenses and the numbers behind your business, in one place.',
  taglineLg: 'Run your team and your numbers from one place.',
  lang: 'العربية', switchLang: 'التبديل إلى العربية',
  loading: 'Loading', close: 'Close', cancel: 'Cancel', back: 'Back', continue: 'Continue', save: 'Save', saved: 'Saved',
  done: 'Done', optional: 'optional', you: 'You', copy: 'Copy', copied: 'Copied', download: 'Download', retry: 'Try again',
  showPassword: 'Show', hidePassword: 'Hide', loadMore: 'Show more',

  // auth
  signIn: 'Sign in', signInTitle: 'Welcome back', signInBody: 'Sign in with your email or phone number.',
  identifier: 'Email or phone', password: 'Password', forgot: 'Forgot password?',
  newBusiness: 'Setting up a new business?', createAccount: 'Create an account', haveAccount: 'Already have an account?',
  twoFactorTitle: 'Two-step verification', twoFactorBody: 'Enter the 6-digit code from your authenticator app.',
  useRecovery: 'Use a recovery code instead', useApp: 'Use the authenticator app instead',
  recoveryCode: 'Recovery code', recoveryBody: 'Enter one of the recovery codes you saved when you turned on two-step verification.',
  code: 'Code', verify: 'Verify',
  registerTitle: 'Set up your business', registerBody: 'Create the owner account. You can invite your team next.',
  businessName: 'Business name', yourName: 'Your full name', email: 'Email', phone: 'Phone',
  contactHint: 'Enter an email, a phone number, or both.',
  passwordHint: 'At least 10 characters. A short sentence is easy to remember.',
  createBtn: 'Create account',
  forgotTitle: 'Reset your password', forgotBody: 'Enter your email or phone and we\'ll send you a link or a code.',
  send: 'Send', forgotSentEmail: 'If there\'s an account for {to}, we\'ve sent a reset link. Check your email.',
  forgotSentPhone: 'If there\'s an account for {to}, we\'ve sent a code by SMS. Enter it below with your new password.',
  resetTitle: 'Choose a new password', newPassword: 'New password', savePassword: 'Save password',
  resetDone: 'Password changed. Sign in with your new password.', smsCode: 'Code from the SMS',
  verifyTitle: 'Verify your account', verifyEmailBody: 'We sent a 6-digit code to {to}. Enter it below or open the link in the email.',
  verifyPhoneBody: 'We sent a 6-digit code by SMS to {to}.', resend: 'Send a new code', resent: 'New code sent',
  verifiedOk: 'Your account is verified', wrongAccount: 'Not you?',
  inviteTitle: 'Join {business}', inviteBody: '{business} invited you to join as {role}. Choose a password to get started.',
  join: 'Join {business}', inviteSignIn: 'You already have an account. Sign in to accept this invitation.',
  inviteSignedInAs: 'You\'re signed in as {name}.', inviteInvalid: 'This invitation link isn\'t valid.',
  inviteExpired: 'This invitation has expired. Ask your manager to send a new one.',
  inviteUsed: 'This invitation has already been used.', inviteRevoked: 'This invitation was cancelled.',
  welcomeTo: 'Welcome to {business}',
  noAccessTitle: 'No business to show', noAccessBody: 'Your account isn\'t part of an active business right now. If you were invited, open the link in your invitation.',

  // roles and statuses
  role_owner: 'Owner', role_manager: 'Manager', role_employee: 'Employee',
  roleA_manager: 'a manager', roleA_employee: 'an employee',
  status_active: 'Active', status_suspended: 'Suspended', status_terminated: 'Terminated', status_archived: 'Archived',
  inv_pending: 'Pending', inv_expired: 'Expired', inv_revoked: 'Cancelled', inv_accepted: 'Accepted',

  // shell
  home: 'Home', team: 'Team', permissions: 'Permissions', audit: 'Activity log', account: 'Account', more: 'More',
  signOut: 'Sign out', switchBusiness: 'Switch business', yourBusinesses: 'Your businesses',

  // home
  goodMorning: 'Good morning, {name}', goodAfternoon: 'Good afternoon, {name}', goodEvening: 'Good evening, {name}',
  roleAt: '{role} at {business}',
  'memberCount.one': '{n} person', 'memberCount.other': '{n} people',
  'pendingInvites.one': '{n} invitation pending', 'pendingInvites.other': '{n} invitations pending',
  setupTitle: 'Get your business ready', stepVerify: 'Verify your contact details', step2fa: 'Turn on two-step verification',
  stepInvite: 'Invite your team', stepPerms: 'Review what managers can do', quickActions: 'Quick actions',
  inviteSomeone: 'Invite someone', allSet: 'You\'re all set',
  employeeBody: 'Your schedule, pay and expenses will appear here as {business} turns them on.',
  secureTitle: 'Protect your account', secureBody: 'Two-step verification stops anyone who learns your password from signing in.',
  turnOn: 'Turn on',

  // team
  members: 'Members', invitations: 'Invitations', searchTeam: 'Search by name, email or phone',
  allRoles: 'All roles', anyStatus: 'Any status', noMatch: 'No one matches this search.',
  noMembersTitle: 'It\'s just you so far', noMembersBody: 'Invite your employees and managers. They\'ll set their own passwords.',
  noInvites: 'No pending invitations.', invite: 'Invite', inviteSheet: 'Invite a team member',
  role: 'Role', fullName: 'Full name', employmentDetails: 'Employment details',
  employeeNumber: 'Employee ID', jobTitle: 'Job title', department: 'Department', startDate: 'Start date',
  payType: 'Pay type', pay_hourly: 'Hourly', pay_salaried: 'Salaried', payRate: 'Pay rate',
  perHour: 'per hour', perMonth: 'per month', inviteContactHint: 'The invitation goes by email if you enter one, otherwise by SMS.',
  sendInvite: 'Send invitation', inviteSent: 'Invitation sent to {name}', resendInvite: 'Resend', revokeInvite: 'Cancel invitation',
  inviteResent: 'Invitation sent again', inviteRevokedToast: 'Invitation cancelled',
  confirmRevokeTitle: 'Cancel this invitation?', confirmRevokeBody: 'The link sent to {name} will stop working.',
  sentAgo: 'Sent {when}', expiresIn: 'Expires {when}', joined: 'Joined {when}',
  makeManager: 'Make manager', removeManager: 'Remove manager role',
  confirmMakeManagerTitle: 'Are you sure you want to give {name} manager permissions?',
  confirmMakeManagerBody: 'They\'ll be able to manage schedules, approve requests and review expenses. You decide exactly what managers can do in Permissions.',
  confirmRemoveManagerTitle: 'Remove manager permissions from {name}?',
  confirmRemoveManagerBody: '{name} stays on the team as an employee. Nothing is deleted.',
  madeManager: '{name} is now a manager', removedManager: '{name} is now an employee',
  suspend: 'Suspend access', reactivate: 'Restore access',
  confirmSuspendTitle: 'Suspend {name}\'s access?',
  confirmSuspendBody: 'They won\'t be able to open this business until you restore access. Their records stay as they are.',
  suspendedToast: '{name}\'s access is suspended', reactivatedToast: '{name}\'s access is restored',
  memberPermissions: 'Permissions for {name}', customBadge: 'Custom', useDefault: 'Use role default',
  contact: 'Contact', call: 'Call', emailAction: 'Email', notSet: 'Not set',

  // permissions page
  permsIntro: 'Owners can always do everything. Changes apply straight away.',
  editRole: 'Settings for', ownerOnlyTitle: 'Only the owner', ownerOnlyBody: 'These can never be given to anyone else.',
  changed: 'Changed', reset: 'Reset',
  group_business: 'Business and security', group_people: 'People', group_scheduling: 'Scheduling and attendance',
  group_finance: 'Money', group_reports: 'Reports and analytics', group_self: 'Their own records',

  // audit
  allActivity: 'All activity', filter_member: 'Team changes', filter_invitation: 'Invitations',
  filter_permissions: 'Permission changes', filter_business: 'Business', from: 'From', to: 'To',
  noActivity: 'No activity matches.', when: 'When', before: 'Before', after: 'After', device: 'Device', ipAddress: 'IP address',
  system: 'System', someone: 'Someone', roles_manager: 'managers', roles_employee: 'employees',
  'a.business.created': '{actor} created the business',
  'a.invitation.created': '{actor} invited {target}',
  'a.invitation.resent': '{actor} resent the invitation to {target}',
  'a.invitation.revoked': '{actor} cancelled the invitation to {target}',
  'a.invitation.accepted': '{actor} joined the team',
  'a.member.promoted_manager': '{actor} made {target} a manager',
  'a.member.manager_removed': '{actor} removed {target}\'s manager role',
  'a.member.suspended': '{actor} suspended {target}\'s access',
  'a.member.reactivated': '{actor} restored {target}\'s access',
  'a.permissions.role_updated': '{actor} changed what {target} can do',
  'a.permissions.member_updated': '{actor} changed {target}\'s permissions',
  'a.other': '{actor}: {action}',

  // account
  profile: 'Profile', contactVerification: 'Contact and verification', verified: 'Verified', notVerified: 'Not verified',
  verifyNow: 'Verify', changePassword: 'Change password', currentPassword: 'Current password',
  passwordChanged: 'Password changed. Your other devices were signed out.',
  twoStep: 'Two-step verification', on: 'On', off: 'Off',
  twoStepBody: 'Ask for a code from an authenticator app each time you sign in.',
  scanQr: 'Scan this with an authenticator app such as Google Authenticator or Microsoft Authenticator.',
  manualKey: 'Or enter this key in the app', openInApp: 'Open in authenticator app', enterAppCode: 'Enter the 6-digit code the app shows.',
  recoveryTitle: 'Save your recovery codes',
  recoverySave: 'Each code works once if you lose your phone. Keep them somewhere safe; you won\'t see them again.',
  savedThem: 'I\'ve saved them', 'recoveryLeft.one': '{n} recovery code left', 'recoveryLeft.other': '{n} recovery codes left',
  turnOff: 'Turn off', turnOffBody: 'Enter your password to turn off two-step verification.',
  twoStepOnToast: 'Two-step verification is on', twoStepOffToast: 'Two-step verification is off',
  devices: 'Signed-in devices', thisDevice: 'This device', activeAgo: 'Active {when}',
  signOutDevice: 'Sign out', signOutOthers: 'Sign out of other devices', signOutAll: 'Sign out everywhere',
  confirmSignOutAllTitle: 'Sign out of every device?', confirmSignOutAllBody: 'This includes this device. You\'ll need your password to sign in again.',
  othersSignedOut: 'Other devices are signed out', deviceSignedOut: 'Device signed out',
  language: 'Language', browserOn: '{browser} on {os}', unknownDevice: 'Unknown device',

  // errors
  'e.network': 'You\'re offline or the server can\'t be reached. Check your connection and try again.',
  'e.invalid_credentials': 'The email, phone or password is incorrect.',
  'e.rate_limited': 'Too many attempts. Please wait a few minutes and try again.',
  'e.weak_password.too_short': 'Use at least 10 characters for your password.',
  'e.weak_password.too_long': 'Use at most 200 characters for your password.',
  'e.weak_password.personal': 'Your password must not contain your email or name.',
  'e.weak_password.predictable': 'Choose a less predictable password.',
  'e.account_exists': 'An account with this email or phone already exists. Sign in instead.',
  'e.invalid_code': 'That code is incorrect or has expired. Request a new one and try again.',
  'e.challenge_expired': 'Your sign-in has expired. Please sign in again.',
  'e.invalid_link': 'This reset link is invalid or has expired. Request a new one.',
  'e.verification_required': 'Please verify your account to continue.',
  'e.access_suspended': 'Your access has been suspended or ended. Contact your business owner.',
  'e.forbidden': 'You don\'t have permission to do this.',
  'e.not_found': 'This item could not be found.',
  'e.csrf': 'Your session has expired. Refresh the page and try again.',
  'e.invalid_input': 'Some of the information entered isn\'t valid. Check it and try again.',
  'e.server_error': 'Something went wrong on our side. Please try again.',
  'e.invitation_expired': 'This invitation has expired. Ask your manager to send a new one.',
  'e.invitation_revoked': 'This invitation can no longer be used.',
  'e.invitation_accepted': 'This invitation has already been used.',
  'e.invitation_closed': 'This invitation can no longer be sent.',
  'e.already_member': 'This person is already part of your team.',
  'e.already_invited': 'This person already has a pending invitation. Resend it instead.',
  'e.contact_required': 'Enter an email address or phone number.',
  'e.invalid_email': 'Enter a valid email address.',
  'e.invalid_phone': 'Enter a valid phone number with its country code.',
  'e.wrong_password': 'Your password is incorrect.',
  'e.2fa_enabled': 'Two-step verification is already on.',
  'e.member_inactive': 'Only active team members can change role.',
  'e.invalid_status': 'This change isn\'t possible for this person\'s current status.',
  'e.unauthorized': 'Please sign in to continue.',
  'e.missing_fields': 'Enter your name and a password.',
  'e.required': 'This is required.',
  errorRef: 'Reference: {id}',

  // permission names
  'p.business.settings.manage': 'Change business settings',
  'p.business.delete': 'Delete the business',
  'p.security.manage': 'Change security settings',
  'p.permissions.manage': 'Change permissions',
  'p.owners.manage': 'Manage owners',
  'p.records.hard_delete': 'Permanently delete records',
  'p.audit.view': 'See the activity log',
  'p.members.view': 'See the team list',
  'p.members.view_sensitive': 'See pay and personal details',
  'p.members.invite': 'Invite employees',
  'p.members.edit': 'Edit employee profiles',
  'p.members.suspend': 'Suspend and restore access',
  'p.members.terminate': 'End employment',
  'p.roles.assign': 'Make or remove managers',
  'p.departments.manage': 'Manage departments',
  'p.schedules.view': 'See everyone\'s schedules',
  'p.schedules.manage': 'Build timetables and assign shifts',
  'p.shift_requests.approve': 'Approve shift and time-off requests',
  'p.swaps.approve': 'Approve shift swaps',
  'p.attendance.view': 'See attendance',
  'p.attendance.manage': 'Correct attendance',
  'p.payroll.view': 'See payroll',
  'p.payroll.manage': 'Run payroll',
  'p.employee_expenses.review': 'Review employee expenses',
  'p.employee_expenses.approve': 'Approve employee expenses',
  'p.business_expenses.view': 'See business expenses',
  'p.business_expenses.manage': 'Record business expenses',
  'p.revenue.view': 'See revenue',
  'p.revenue.manage': 'Record revenue',
  'p.budgets.manage': 'Set budgets',
  'p.finance.view': 'See profit and loss',
  'p.analytics.view': 'See business statistics',
  'p.reports.operational': 'Create operational reports',
  'p.reports.financial': 'Create financial reports',
  'p.reports.export': 'Export reports',
  'p.self.schedule': 'See their own schedule',
  'p.self.requests': 'Request shift changes and time off',
  'p.self.swaps': 'Swap shifts',
  'p.self.pay': 'See their own pay',
  'p.self.expenses': 'Submit work expenses',
  'p.self.profile': 'Update their own profile',
};

const ar = {
  appName: 'إدارة الأعمال',
  tagline: 'الجداول والرواتب والمصاريف وأرقام نشاطك التجاري، في مكان واحد.',
  taglineLg: 'أدِر فريقك وأرقامك من مكان واحد.',
  lang: 'English', switchLang: 'Switch to English',
  loading: 'جارٍ التحميل', close: 'إغلاق', cancel: 'إلغاء', back: 'رجوع', continue: 'متابعة', save: 'حفظ', saved: 'تم الحفظ',
  done: 'تم', optional: 'اختياري', you: 'أنت', copy: 'نسخ', copied: 'تم النسخ', download: 'تنزيل', retry: 'حاول مجدداً',
  showPassword: 'إظهار', hidePassword: 'إخفاء', loadMore: 'عرض المزيد',

  signIn: 'تسجيل الدخول', signInTitle: 'أهلاً بعودتك', signInBody: 'سجّل الدخول ببريدك الإلكتروني أو رقم هاتفك.',
  identifier: 'البريد الإلكتروني أو الهاتف', password: 'كلمة المرور', forgot: 'نسيت كلمة المرور؟',
  newBusiness: 'تجهّز نشاطاً تجارياً جديداً؟', createAccount: 'أنشئ حساباً', haveAccount: 'لديك حساب بالفعل؟',
  twoFactorTitle: 'التحقق بخطوتين', twoFactorBody: 'أدخل الرمز المكوّن من ٦ أرقام من تطبيق المصادقة.',
  useRecovery: 'استخدم رمز استرداد بدلاً من ذلك', useApp: 'استخدم تطبيق المصادقة بدلاً من ذلك',
  recoveryCode: 'رمز الاسترداد', recoveryBody: 'أدخل أحد رموز الاسترداد التي حفظتها عند تفعيل التحقق بخطوتين.',
  code: 'الرمز', verify: 'تحقّق',
  registerTitle: 'جهّز نشاطك التجاري', registerBody: 'أنشئ حساب المالك، ثم ادعُ فريقك.',
  businessName: 'اسم النشاط التجاري', yourName: 'اسمك الكامل', email: 'البريد الإلكتروني', phone: 'الهاتف',
  contactHint: 'أدخل بريداً إلكترونياً أو رقم هاتف أو كليهما.',
  passwordHint: '١٠ أحرف على الأقل. جملة قصيرة يسهل تذكّرها.',
  createBtn: 'إنشاء الحساب',
  forgotTitle: 'إعادة تعيين كلمة المرور', forgotBody: 'أدخل بريدك أو هاتفك وسنرسل لك رابطاً أو رمزاً.',
  send: 'إرسال', forgotSentEmail: 'إذا كان هناك حساب لـ {to} فقد أرسلنا رابط إعادة التعيين. تحقّق من بريدك.',
  forgotSentPhone: 'إذا كان هناك حساب لـ {to} فقد أرسلنا رمزاً برسالة نصية. أدخله أدناه مع كلمة المرور الجديدة.',
  resetTitle: 'اختر كلمة مرور جديدة', newPassword: 'كلمة المرور الجديدة', savePassword: 'حفظ كلمة المرور',
  resetDone: 'تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.', smsCode: 'الرمز من الرسالة النصية',
  verifyTitle: 'تحقّق من حسابك', verifyEmailBody: 'أرسلنا رمزاً من ٦ أرقام إلى {to}. أدخله أدناه أو افتح الرابط في الرسالة.',
  verifyPhoneBody: 'أرسلنا رمزاً من ٦ أرقام برسالة نصية إلى {to}.', resend: 'أرسل رمزاً جديداً', resent: 'تم إرسال رمز جديد',
  verifiedOk: 'تم التحقق من حسابك', wrongAccount: 'لست أنت؟',
  inviteTitle: 'انضم إلى {business}', inviteBody: 'دعاك {business} للانضمام بصفة {role}. اختر كلمة مرور للبدء.',
  join: 'انضم إلى {business}', inviteSignIn: 'لديك حساب بالفعل. سجّل الدخول لقبول هذه الدعوة.',
  inviteSignedInAs: 'أنت مسجّل الدخول باسم {name}.', inviteInvalid: 'رابط الدعوة غير صالح.',
  inviteExpired: 'انتهت صلاحية هذه الدعوة. اطلب من مديرك إرسال دعوة جديدة.',
  inviteUsed: 'استُخدمت هذه الدعوة من قبل.', inviteRevoked: 'أُلغيت هذه الدعوة.',
  welcomeTo: 'أهلاً بك في {business}',
  noAccessTitle: 'لا يوجد نشاط لعرضه', noAccessBody: 'حسابك ليس ضمن نشاط تجاري فعّال حالياً. إذا وصلتك دعوة، افتح الرابط الموجود فيها.',

  role_owner: 'المالك', role_manager: 'مدير', role_employee: 'موظف',
  roleA_manager: 'مدير', roleA_employee: 'موظف',
  status_active: 'نشِط', status_suspended: 'موقوف', status_terminated: 'منتهي الخدمة', status_archived: 'مؤرشف',
  inv_pending: 'بانتظار القبول', inv_expired: 'منتهية', inv_revoked: 'ملغاة', inv_accepted: 'مقبولة',

  home: 'الرئيسية', team: 'الفريق', permissions: 'الصلاحيات', audit: 'سجل النشاط', account: 'الحساب', more: 'المزيد',
  signOut: 'تسجيل الخروج', switchBusiness: 'تبديل النشاط', yourBusinesses: 'أنشطتك التجارية',

  goodMorning: 'صباح الخير، {name}', goodAfternoon: 'مساء الخير، {name}', goodEvening: 'مساء الخير، {name}',
  roleAt: '{role} في {business}',
  'memberCount.zero': 'لا أحد', 'memberCount.one': 'شخص واحد', 'memberCount.two': 'شخصان',
  'memberCount.few': '{n} أشخاص', 'memberCount.many': '{n} شخصاً', 'memberCount.other': '{n} شخص',
  'pendingInvites.one': 'دعوة واحدة بانتظار القبول', 'pendingInvites.two': 'دعوتان بانتظار القبول',
  'pendingInvites.few': '{n} دعوات بانتظار القبول', 'pendingInvites.many': '{n} دعوة بانتظار القبول', 'pendingInvites.other': '{n} دعوة بانتظار القبول',
  setupTitle: 'جهّز نشاطك التجاري', stepVerify: 'تحقّق من بيانات التواصل', step2fa: 'فعّل التحقق بخطوتين',
  stepInvite: 'ادعُ فريقك', stepPerms: 'راجع ما يمكن للمدراء فعله', quickActions: 'إجراءات سريعة',
  inviteSomeone: 'دعوة شخص', allSet: 'كل شيء جاهز',
  employeeBody: 'سيظهر هنا جدولك وراتبك ومصاريفك عندما يفعّلها {business}.',
  secureTitle: 'احمِ حسابك', secureBody: 'التحقق بخطوتين يمنع أي شخص يعرف كلمة مرورك من الدخول.',
  turnOn: 'تفعيل',

  members: 'الأعضاء', invitations: 'الدعوات', searchTeam: 'ابحث بالاسم أو البريد أو الهاتف',
  allRoles: 'كل الأدوار', anyStatus: 'كل الحالات', noMatch: 'لا أحد يطابق هذا البحث.',
  noMembersTitle: 'أنت وحدك حتى الآن', noMembersBody: 'ادعُ موظفيك ومدراءك، وسيختار كل منهم كلمة مروره.',
  noInvites: 'لا توجد دعوات معلّقة.', invite: 'دعوة', inviteSheet: 'دعوة عضو جديد',
  role: 'الدور', fullName: 'الاسم الكامل', employmentDetails: 'بيانات التوظيف',
  employeeNumber: 'الرقم الوظيفي', jobTitle: 'المسمى الوظيفي', department: 'القسم', startDate: 'تاريخ المباشرة',
  payType: 'نوع الأجر', pay_hourly: 'بالساعة', pay_salaried: 'راتب ثابت', payRate: 'الأجر',
  perHour: 'للساعة', perMonth: 'شهرياً', inviteContactHint: 'تُرسل الدعوة بالبريد إن أدخلته، وإلا برسالة نصية.',
  sendInvite: 'إرسال الدعوة', inviteSent: 'أُرسلت الدعوة إلى {name}', resendInvite: 'إعادة الإرسال', revokeInvite: 'إلغاء الدعوة',
  inviteResent: 'أُعيد إرسال الدعوة', inviteRevokedToast: 'أُلغيت الدعوة',
  confirmRevokeTitle: 'إلغاء هذه الدعوة؟', confirmRevokeBody: 'سيتوقف الرابط المرسل إلى {name} عن العمل.',
  sentAgo: 'أُرسلت {when}', expiresIn: 'تنتهي {when}', joined: 'انضم {when}',
  makeManager: 'تعيينه مديراً', removeManager: 'إزالة صلاحية المدير',
  confirmMakeManagerTitle: 'هل أنت متأكد من منح {name} صلاحيات المدير؟',
  confirmMakeManagerBody: 'سيتمكن من إدارة الجداول والموافقة على الطلبات ومراجعة المصاريف. تحدد أنت بدقة ما يمكن للمدراء فعله من صفحة الصلاحيات.',
  confirmRemoveManagerTitle: 'إزالة صلاحيات المدير من {name}؟',
  confirmRemoveManagerBody: 'يبقى {name} في الفريق كموظف، ولا يُحذف أي شيء.',
  madeManager: '{name} الآن مدير', removedManager: '{name} الآن موظف',
  suspend: 'إيقاف الوصول', reactivate: 'إعادة الوصول',
  confirmSuspendTitle: 'إيقاف وصول {name}؟',
  confirmSuspendBody: 'لن يتمكن من فتح هذا النشاط حتى تعيد وصوله، وتبقى سجلاته كما هي.',
  suspendedToast: 'أُوقف وصول {name}', reactivatedToast: 'أُعيد وصول {name}',
  memberPermissions: 'صلاحيات {name}', customBadge: 'مخصّص', useDefault: 'استخدم إعداد الدور',
  contact: 'التواصل', call: 'اتصال', emailAction: 'مراسلة', notSet: 'غير محدد',

  permsIntro: 'المالك يستطيع كل شيء دائماً. تُطبَّق التغييرات فوراً.',
  editRole: 'إعدادات', ownerOnlyTitle: 'للمالك فقط', ownerOnlyBody: 'لا يمكن منح هذه الصلاحيات لأي شخص آخر.',
  changed: 'معدَّل', reset: 'إعادة الضبط',
  group_business: 'النشاط والأمان', group_people: 'الأشخاص', group_scheduling: 'الجداول والحضور',
  group_finance: 'المال', group_reports: 'التقارير والتحليلات', group_self: 'سجلاتهم الخاصة',

  allActivity: 'كل النشاط', filter_member: 'تغييرات الفريق', filter_invitation: 'الدعوات',
  filter_permissions: 'تغييرات الصلاحيات', filter_business: 'النشاط التجاري', from: 'من', to: 'إلى',
  noActivity: 'لا يوجد نشاط مطابق.', when: 'الوقت', before: 'قبل', after: 'بعد', device: 'الجهاز', ipAddress: 'عنوان IP',
  system: 'النظام', someone: 'شخص ما', roles_manager: 'المدراء', roles_employee: 'الموظفين',
  'a.business.created': 'أنشأ {actor} النشاط التجاري',
  'a.invitation.created': 'دعا {actor} {target}',
  'a.invitation.resent': 'أعاد {actor} إرسال الدعوة إلى {target}',
  'a.invitation.revoked': 'ألغى {actor} الدعوة المرسلة إلى {target}',
  'a.invitation.accepted': 'انضم {actor} إلى الفريق',
  'a.member.promoted_manager': 'عيّن {actor} {target} مديراً',
  'a.member.manager_removed': 'أزال {actor} صلاحية المدير من {target}',
  'a.member.suspended': 'أوقف {actor} وصول {target}',
  'a.member.reactivated': 'أعاد {actor} وصول {target}',
  'a.permissions.role_updated': 'غيّر {actor} صلاحيات {target}',
  'a.permissions.member_updated': 'غيّر {actor} صلاحيات {target}',
  'a.other': '{actor}: {action}',

  profile: 'الملف الشخصي', contactVerification: 'التواصل والتحقق', verified: 'متحقَّق منه', notVerified: 'غير متحقَّق منه',
  verifyNow: 'تحقّق', changePassword: 'تغيير كلمة المرور', currentPassword: 'كلمة المرور الحالية',
  passwordChanged: 'تم تغيير كلمة المرور وتسجيل الخروج من أجهزتك الأخرى.',
  twoStep: 'التحقق بخطوتين', on: 'مفعّل', off: 'غير مفعّل',
  twoStepBody: 'طلب رمز من تطبيق المصادقة عند كل تسجيل دخول.',
  scanQr: 'امسح هذا الرمز بتطبيق مصادقة مثل Google Authenticator أو Microsoft Authenticator.',
  manualKey: 'أو أدخل هذا المفتاح في التطبيق', openInApp: 'فتح في تطبيق المصادقة', enterAppCode: 'أدخل الرمز المكوّن من ٦ أرقام الذي يظهره التطبيق.',
  recoveryTitle: 'احفظ رموز الاسترداد',
  recoverySave: 'كل رمز يعمل مرة واحدة إذا فقدت هاتفك. احفظها في مكان آمن، فلن تظهر مجدداً.',
  savedThem: 'حفظتها', 'recoveryLeft.zero': 'لم يتبقَّ أي رمز استرداد', 'recoveryLeft.one': 'تبقّى رمز استرداد واحد',
  'recoveryLeft.two': 'تبقّى رمزا استرداد', 'recoveryLeft.few': 'تبقّت {n} رموز استرداد', 'recoveryLeft.many': 'تبقّى {n} رمزاً للاسترداد',
  'recoveryLeft.other': 'تبقّى {n} رمز استرداد',
  turnOff: 'إيقاف', turnOffBody: 'أدخل كلمة المرور لإيقاف التحقق بخطوتين.',
  twoStepOnToast: 'تم تفعيل التحقق بخطوتين', twoStepOffToast: 'تم إيقاف التحقق بخطوتين',
  devices: 'الأجهزة المسجّلة', thisDevice: 'هذا الجهاز', activeAgo: 'نشِط {when}',
  signOutDevice: 'تسجيل الخروج', signOutOthers: 'تسجيل الخروج من الأجهزة الأخرى', signOutAll: 'تسجيل الخروج من كل الأجهزة',
  confirmSignOutAllTitle: 'تسجيل الخروج من كل الأجهزة؟', confirmSignOutAllBody: 'يشمل ذلك هذا الجهاز، وستحتاج كلمة المرور للدخول مجدداً.',
  othersSignedOut: 'تم تسجيل الخروج من الأجهزة الأخرى', deviceSignedOut: 'تم تسجيل خروج الجهاز',
  language: 'اللغة', browserOn: '{browser} على {os}', unknownDevice: 'جهاز غير معروف',

  'e.network': 'لا يوجد اتصال بالخادم. تحقّق من الاتصال وحاول مجدداً.',
  'e.invalid_credentials': 'البريد أو الهاتف أو كلمة المرور غير صحيحة.',
  'e.rate_limited': 'محاولات كثيرة. انتظر بضع دقائق ثم حاول مجدداً.',
  'e.weak_password.too_short': 'استخدم ١٠ أحرف على الأقل لكلمة المرور.',
  'e.weak_password.too_long': 'استخدم ٢٠٠ حرف كحد أقصى لكلمة المرور.',
  'e.weak_password.personal': 'يجب ألّا تحتوي كلمة المرور على بريدك أو اسمك.',
  'e.weak_password.predictable': 'اختر كلمة مرور يصعب توقّعها.',
  'e.account_exists': 'يوجد حساب بهذا البريد أو الهاتف. سجّل الدخول بدلاً من ذلك.',
  'e.invalid_code': 'الرمز غير صحيح أو منتهي الصلاحية. اطلب رمزاً جديداً وحاول مجدداً.',
  'e.challenge_expired': 'انتهت مهلة تسجيل الدخول. سجّل الدخول مجدداً.',
  'e.invalid_link': 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية. اطلب رابطاً جديداً.',
  'e.verification_required': 'يرجى التحقق من حسابك للمتابعة.',
  'e.access_suspended': 'أُوقف وصولك أو انتهى. تواصل مع مالك النشاط.',
  'e.forbidden': 'ليست لديك صلاحية للقيام بذلك.',
  'e.not_found': 'تعذّر العثور على هذا العنصر.',
  'e.csrf': 'انتهت جلستك. حدّث الصفحة وحاول مجدداً.',
  'e.invalid_input': 'بعض البيانات المدخلة غير صحيحة. راجعها وحاول مجدداً.',
  'e.server_error': 'حدث خطأ من جهتنا. حاول مجدداً.',
  'e.invitation_expired': 'انتهت صلاحية هذه الدعوة. اطلب من مديرك إرسال دعوة جديدة.',
  'e.invitation_revoked': 'لم يعد بالإمكان استخدام هذه الدعوة.',
  'e.invitation_accepted': 'استُخدمت هذه الدعوة من قبل.',
  'e.invitation_closed': 'لم يعد بالإمكان إرسال هذه الدعوة.',
  'e.already_member': 'هذا الشخص عضو في فريقك بالفعل.',
  'e.already_invited': 'لدى هذا الشخص دعوة معلّقة. أعد إرسالها بدلاً من ذلك.',
  'e.contact_required': 'أدخل بريداً إلكترونياً أو رقم هاتف.',
  'e.invalid_email': 'أدخل بريداً إلكترونياً صحيحاً.',
  'e.invalid_phone': 'أدخل رقم هاتف صحيحاً مع رمز الدولة.',
  'e.wrong_password': 'كلمة المرور غير صحيحة.',
  'e.2fa_enabled': 'التحقق بخطوتين مفعّل بالفعل.',
  'e.member_inactive': 'يمكن تغيير دور الأعضاء النشطين فقط.',
  'e.invalid_status': 'هذا التغيير غير ممكن مع حالة هذا الشخص الحالية.',
  'e.unauthorized': 'سجّل الدخول للمتابعة.',
  'e.missing_fields': 'أدخل اسمك وكلمة مرور.',
  'e.required': 'هذا الحقل مطلوب.',
  errorRef: 'المرجع: {id}',

  'p.business.settings.manage': 'تغيير إعدادات النشاط',
  'p.business.delete': 'حذف النشاط التجاري',
  'p.security.manage': 'تغيير إعدادات الأمان',
  'p.permissions.manage': 'تغيير الصلاحيات',
  'p.owners.manage': 'إدارة المالكين',
  'p.records.hard_delete': 'حذف السجلات نهائياً',
  'p.audit.view': 'عرض سجل النشاط',
  'p.members.view': 'عرض قائمة الفريق',
  'p.members.view_sensitive': 'عرض الأجور والبيانات الشخصية',
  'p.members.invite': 'دعوة الموظفين',
  'p.members.edit': 'تعديل ملفات الموظفين',
  'p.members.suspend': 'إيقاف الوصول وإعادته',
  'p.members.terminate': 'إنهاء الخدمة',
  'p.roles.assign': 'تعيين المدراء وإزالتهم',
  'p.departments.manage': 'إدارة الأقسام',
  'p.schedules.view': 'عرض جداول الجميع',
  'p.schedules.manage': 'إعداد الجداول وتوزيع المناوبات',
  'p.shift_requests.approve': 'الموافقة على طلبات تغيير المناوبة والإجازات',
  'p.swaps.approve': 'الموافقة على تبديل المناوبات',
  'p.attendance.view': 'عرض الحضور',
  'p.attendance.manage': 'تصحيح الحضور',
  'p.payroll.view': 'عرض الرواتب',
  'p.payroll.manage': 'إعداد الرواتب',
  'p.employee_expenses.review': 'مراجعة مصاريف الموظفين',
  'p.employee_expenses.approve': 'الموافقة على مصاريف الموظفين',
  'p.business_expenses.view': 'عرض مصاريف النشاط',
  'p.business_expenses.manage': 'تسجيل مصاريف النشاط',
  'p.revenue.view': 'عرض الإيرادات',
  'p.revenue.manage': 'تسجيل الإيرادات',
  'p.budgets.manage': 'تحديد الميزانيات',
  'p.finance.view': 'عرض الأرباح والخسائر',
  'p.analytics.view': 'عرض إحصاءات النشاط',
  'p.reports.operational': 'إعداد التقارير التشغيلية',
  'p.reports.financial': 'إعداد التقارير المالية',
  'p.reports.export': 'تصدير التقارير',
  'p.self.schedule': 'عرض جدولهم الخاص',
  'p.self.requests': 'طلب تغيير المناوبة والإجازات',
  'p.self.swaps': 'تبديل المناوبات',
  'p.self.pay': 'عرض رواتبهم',
  'p.self.expenses': 'تقديم مصاريف العمل',
  'p.self.profile': 'تحديث ملفهم الشخصي',
};

// Earlier modules' strings win over the operations file where keys overlap.
const STR = { en: { ...enOps, ...en }, ar: { ...arOps, ...ar } };

// A stored value that isn't a known language (an old or edited setting) is ignored.
const saved = LS.get('lang');
export let LANG = saved in STR ? saved : ((navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'ar');

export function t(key, vars) {
  let s = STR[LANG][key] ?? STR.en[key] ?? key;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
  return s;
}

// Plural-aware text: picks key.one / key.few / key.other … for the language.
export function tn(key, n) {
  const form = new Intl.PluralRules(LANG).select(n);
  const k = [`${key}.${form}`, `${key}.other`].find((x) => x in STR[LANG]) || `${key}.other`;
  return t(k, { n: fmtInt(n) });
}

export const has = (key) => key in STR[LANG] || key in STR.en;

export function setLang(lang) {
  LANG = lang === 'en' ? 'en' : 'ar';
  LS.set('lang', LANG);
  applyLang();
}

export function applyLang() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  document.title = t('appName');
}

export const locale = () => (LANG === 'ar' ? 'ar-IQ' : 'en-GB');

export function fmtDateTime(iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  try {
    return new Intl.DateTimeFormat(locale(), opts).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

export function fmtDate(iso, opts = { dateStyle: 'medium' }) {
  return fmtDateTime(iso, opts);
}

// "3 minutes ago", "in 6 days".
export function relTime(iso) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(iso);
}

export const fmtInt = (n) => new Intl.NumberFormat(locale()).format(n);

export function fmtMoney(minor, currency, exponent) {
  const major = minor / 10 ** exponent;
  return new Intl.NumberFormat(locale(), { style: 'currency', currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(major);
}
