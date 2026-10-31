/**
 * إعدادات الشركة — عدّل هذه القيم فقط لتغيير بيانات الموقع في كل مكان.
 */
export const site = {
  nameAr: 'الماس',
  nameEn: 'Al-maas',
  tagline: 'عالم التكنولوجيا بين يديك',
  /** رقم WhatsApp بالصيغة الدولية بدون + */
  whatsapp: '9647822233611',
  phoneDisplay: '0782 223 3611',
  phoneIntl: '+9647822233611',
  city: 'الناصرية',
  region: 'ذي قار',
  country: 'العراق',
  addressLine: 'الناصرية، محافظة ذي قار، العراق',
  hours: 'السبت – الخميس: ‎10:00 ص – 10:00 م',
  hoursFriday: 'الجمعة: ‎4:00 م – 10:00 م',
  /** رابط خرائط Google — ضع رابط موقع المحل الدقيق عند توفره */
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=%D8%A7%D9%84%D9%86%D8%A7%D8%B5%D8%B1%D9%8A%D8%A9+%D8%B0%D9%8A+%D9%82%D8%A7%D8%B1',
  mapsEmbed: 'https://www.google.com/maps?q=Nasiriyah,+Dhi+Qar,+Iraq&z=14&output=embed',
  social: {
    instagram: 'https://instagram.com/',
    facebook: 'https://facebook.com/',
    tiktok: 'https://tiktok.com/',
  },
  siteUrl: (import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://almaas.iq',
  currency: 'IQD',
} as const;
