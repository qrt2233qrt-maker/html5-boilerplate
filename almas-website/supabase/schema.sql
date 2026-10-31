-- =====================================================================
--  الماس | Al-maas — مخطط قاعدة بيانات Supabase
--  شغّل هذا الملف كاملاً من: Supabase Dashboard → SQL Editor → New query
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- المدراء ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select using (user_id = auth.uid());

-- ---------- المنتجات ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  brand text not null default '',
  category text not null check (category in ('phones','tablets','headphones','chargers','cases','accessories')),
  price integer not null check (price >= 0),
  old_price integer check (old_price >= 0),
  description text not null default '',
  specs jsonb not null default '[]'::jsonb,
  colors text[] not null default '{}',
  images text[] not null default '{}',
  stock integer not null default 0,
  featured boolean not null default false,
  is_new boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists products_category_idx on public.products (category);
alter table public.products enable row level security;

drop policy if exists "products public read" on public.products;
create policy "products public read" on public.products for select using (true);
drop policy if exists "products admin write" on public.products;
create policy "products admin write" on public.products for all using (public.is_admin()) with check (public.is_admin());

-- ---------- حجوزات الصيانة ----------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  phone text not null check (char_length(phone) between 6 and 30),
  device text not null check (char_length(device) <= 120),
  service text not null check (char_length(service) <= 120),
  issue text not null default '' check (char_length(issue) <= 2000),
  date text not null default '',
  time text not null default '',
  status text not null default 'new' check (status in ('new','confirmed','in_progress','done','cancelled')),
  created_at timestamptz not null default now()
);
alter table public.bookings enable row level security;

drop policy if exists "bookings public insert" on public.bookings;
create policy "bookings public insert" on public.bookings for insert with check (status = 'new');
drop policy if exists "bookings admin all" on public.bookings;
create policy "bookings admin all" on public.bookings for all using (public.is_admin()) with check (public.is_admin());

-- ---------- الطلبات ----------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  phone text not null check (char_length(phone) between 6 and 30),
  address text not null check (char_length(address) <= 400),
  notes text not null default '' check (char_length(notes) <= 1000),
  items jsonb not null default '[]'::jsonb,
  total integer not null default 0,
  status text not null default 'new' check (status in ('new','confirmed','delivered','cancelled')),
  created_at timestamptz not null default now()
);
alter table public.orders enable row level security;

drop policy if exists "orders public insert" on public.orders;
create policy "orders public insert" on public.orders for insert with check (status = 'new');
drop policy if exists "orders admin all" on public.orders;
create policy "orders admin all" on public.orders for all using (public.is_admin()) with check (public.is_admin());

-- ---------- تخزين صور المنتجات ----------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "product images public read" on storage.objects;
create policy "product images public read" on storage.objects
  for select using (bucket_id = 'product-images');
drop policy if exists "product images admin insert" on storage.objects;
create policy "product images admin insert" on storage.objects
  for insert with check (bucket_id = 'product-images' and public.is_admin());
drop policy if exists "product images admin update" on storage.objects;
create policy "product images admin update" on storage.objects
  for update using (bucket_id = 'product-images' and public.is_admin());
drop policy if exists "product images admin delete" on storage.objects;
create policy "product images admin delete" on storage.objects
  for delete using (bucket_id = 'product-images' and public.is_admin());

-- =====================================================================
--  بعد إنشاء حساب المدير من Authentication → Users، شغّل السطر التالي
--  مع استبدال البريد ببريدك:
--
--  insert into public.admins (user_id)
--  select id from auth.users where email = 'admin@almaas.iq';
-- =====================================================================
