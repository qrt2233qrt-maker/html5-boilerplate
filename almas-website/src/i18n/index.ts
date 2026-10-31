import { ar, type Dictionary } from './ar';

/**
 * طبقة الترجمة. حالياً العربية فقط.
 * لإضافة الإنجليزية لاحقاً: أنشئ `en.ts` يصدّر كائناً من النوع Dictionary،
 * أضفه إلى `dictionaries`، واجعل `locale` قابلاً للتبديل (مثلاً عبر Zustand).
 */
const dictionaries: Record<string, Dictionary> = { ar };

export const locale = 'ar';
export const t: Dictionary = dictionaries[locale];
