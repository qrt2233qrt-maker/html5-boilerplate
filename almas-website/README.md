# الماس | Al-maas — موقع المتجر ومركز الصيانة

موقع احترافي لمتجر **الماس** في الناصرية – ذي قار: بيع الهواتف والأجهزة والإكسسوارات وصيانة الأجهزة.

**التقنيات:** React 19 + TypeScript + Vite · Three.js / React Three Fiber (هاتف ثلاثي الأبعاد) · GSAP + ScrollTrigger · Lenis (تمرير ناعم) · Tailwind CSS · Zustand · Supabase (قاعدة بيانات + صور + تسجيل دخول المدير).

---

## التشغيل محلياً

```bash
cd almas-website
npm install
npm run dev        # http://localhost:5173
npm run build      # بناء نسخة النشر داخل dist/
```

بدون إعداد Supabase يعمل الموقع في **الوضع التجريبي**: المنتجات والطلبات تُحفظ في متصفحك فقط.
لوحة التحكم: `/admin` — البريد `admin@almaas.iq` وكلمة المرور `almaas2026` (للوضع التجريبي فقط).

---

## الصفحات

| المسار | المحتوى |
|---|---|
| `/` | الرئيسية: Hero بهاتف 3D، أحدث الأجهزة، الإكسسوارات، الصيانة، لماذا نحن، آراء العملاء، التواصل والخريطة |
| `/store` | المتجر: بحث، فئات، فلترة بالسعر والماركة، ترتيب (الفلاتر محفوظة في الرابط) |
| `/product/:slug` | صفحة مستقلة لكل منتج + ألوان + مواصفات + سلة + طلب WhatsApp |
| `/cart` | السلة وإتمام الطلب عبر WhatsApp (ويُحفظ الطلب في لوحة التحكم) |
| `/maintenance` | خدمات الصيانة + نموذج حجز موعد + WhatsApp مباشر |
| `/contact` | العنوان، الهاتف، ساعات العمل، الخريطة |
| `/admin` | لوحة التحكم: إضافة/تعديل/حذف المنتجات ورفع صورها، الحجوزات، الطلبات |

---

## تفعيل الحفظ الحقيقي (Supabase — مجاني)

1. أنشئ حساباً ومشروعاً جديداً على <https://supabase.com>.
2. من **SQL Editor** الصق محتوى الملف `supabase/schema.sql` كاملاً واضغط **Run**.
   (ينشئ جداول المنتجات والحجوزات والطلبات، وحاوية الصور `product-images`، وصلاحيات الأمان).
3. من **Authentication → Users → Add user** أنشئ حساب المدير (بريد + كلمة مرور قوية).
4. ارجع إلى **SQL Editor** وشغّل (مع تغيير البريد):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'بريدك@example.com';
   ```
5. من **Authentication → Sign In / Providers** أوقف خيار **Allow new users to sign up** حتى لا يسجّل أحد غيرك.
6. من **Project Settings → API** انسخ `Project URL` و `anon public key`، وأنشئ ملف `.env` بجانب `package.json`:
   ```env
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   VITE_SITE_URL=https://your-domain.com
   ```
7. ادخل `/admin` بحساب المدير وابدأ بإضافة منتجاتك ورفع صورها الرسمية.

> المنتجات التجريبية الحالية موجودة فقط في الوضع التجريبي. بعد تفعيل Supabase تبدأ قاعدة البيانات فارغة وتضيف منتجاتك من لوحة التحكم.
> الصور تُضغط تلقائياً إلى WebP قبل الرفع للحفاظ على سرعة الموقع. المنتج بدون صورة يظهر برسم مولّد حسب فئته ولونه.

---

## النشر

### Vercel (موصى به)
1. ارفع المشروع على GitHub.
2. في Vercel: **Add New Project** → اختر المستودع → **Root Directory:** `almas-website`.
3. أضف متغيرات البيئة الثلاثة من الخطوة 6 أعلاه → **Deploy**.
   ملف `vercel.json` جاهز لتوجيه المسارات وتخزين الملفات مؤقتاً.

### Netlify
Base directory: `almas-website` · Build command: `npm run build` · Publish directory: `almas-website/dist`.
ملف `public/_redirects` جاهز.

بعد ربط النطاق، عدّل الرابط في `public/robots.txt` و `public/sitemap.xml`.

---

## التخصيص السريع

| ماذا تريد أن تغيّر | الملف |
|---|---|
| الاسم، رقم WhatsApp، العنوان، ساعات العمل، روابط التواصل والخريطة | `src/config/site.ts` |
| كل نصوص الموقع | `src/i18n/ar.ts` |
| خدمات الصيانة وأسعارها، آراء العملاء، «لماذا نحن» | `src/data/seed.ts` |
| الألوان والخطوط | `tailwind.config.js` و `src/index.css` |
| ملاحظات SEO الأساسية والبيانات المنظمة | `index.html` |

### إضافة اللغة الإنجليزية لاحقاً
البنية جاهزة: أنشئ `src/i18n/en.ts` بنفس شكل `ar.ts` (النوع `Dictionary`)، أضفه في `src/i18n/index.ts`، واجعل اللغة قابلة للتبديل مع ضبط `dir="ltr"`. التصميم يستخدم خصائص CSS المنطقية (start/end) فيتكيّف تلقائياً مع الاتجاهين.

---

## الأداء و SEO
- Three.js يُحمَّل كسولاً للـ Hero فقط ويتوقف عن الرسم عند الخروج من الشاشة؛ مع بديل SVG للأجهزة التي لا تدعم WebGL.
- تقسيم الصفحات (code-splitting)، خطوط مستضافة ذاتياً، وصور lazy-loading.
- احترام إعداد «تقليل الحركة» في النظام.
- عناوين ووصف لكل صفحة، Open Graph، بيانات منظمة (ElectronicsStore / Product / Service)، sitemap و robots.
