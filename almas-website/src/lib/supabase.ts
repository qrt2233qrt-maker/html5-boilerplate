import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'));

let client: Promise<SupabaseClient> | null = null;

/** تحميل كسول لمكتبة Supabase حتى لا تؤثر على سرعة الصفحة الأولى */
export function getSupabase(): Promise<SupabaseClient> {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured');
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } }),
  );
  return client;
}

export const PRODUCT_BUCKET = 'product-images';
