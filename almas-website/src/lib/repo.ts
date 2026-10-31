import { seedProducts } from '@/data/seed';
import type {
  Booking, BookingInput, BookingStatus, Order, OrderInput, OrderStatus, Product, ProductInput,
} from '@/types';
import { blobToDataUrl, compressImage } from './image';
import { slugify, uid } from './format';
import { getSupabase, isSupabaseConfigured, PRODUCT_BUCKET } from './supabase';

/** واجهة موحّدة للبيانات — نفس الكود يعمل مع Supabase أو بالوضع التجريبي المحلي */
export interface DataRepo {
  mode: 'supabase' | 'demo';
  listProducts(): Promise<Product[]>;
  saveProduct(input: ProductInput, id?: string): Promise<Product>;
  deleteProduct(id: string): Promise<void>;
  uploadImage(file: File): Promise<string>;
  createBooking(input: BookingInput): Promise<Booking>;
  listBookings(): Promise<Booking[]>;
  setBookingStatus(id: string, status: BookingStatus): Promise<void>;
  deleteBooking(id: string): Promise<void>;
  createOrder(input: OrderInput): Promise<Order>;
  listOrders(): Promise<Order[]>;
  setOrderStatus(id: string, status: OrderStatus): Promise<void>;
  deleteOrder(id: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  isAdmin(): Promise<boolean>;
}

export const shortRef = (id: string) => id.replace(/-/g, '').slice(0, 6).toUpperCase();

/* ------------------------------------------------------------------ */
/*  الوضع التجريبي: localStorage                                       */
/* ------------------------------------------------------------------ */
const LS = { products: 'almaas.products.v1', bookings: 'almaas.bookings.v1', orders: 'almaas.orders.v1', admin: 'almaas.admin.v1' };
export const DEMO_ADMIN = { email: 'admin@almaas.iq', password: 'almaas2026' };

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('مساحة التخزين في المتصفح ممتلئة. في الوضع التجريبي استخدم صوراً أقل، أو فعّل Supabase.');
  }
};

const uniqueSlug = (wanted: string, list: Product[], selfId?: string) => {
  let s = wanted;
  let n = 2;
  while (list.some((p) => p.slug === s && p.id !== selfId)) s = `${wanted}-${n++}`;
  return s;
};

const localRepo: DataRepo = {
  mode: 'demo',
  async listProducts() {
    return read<Product[]>(LS.products, seedProducts);
  },
  async saveProduct(input, id) {
    const list = read<Product[]>(LS.products, seedProducts);
    const existing = id ? list.find((p) => p.id === id) : undefined;
    const slug = uniqueSlug(input.slug || slugify(`${input.brand} ${input.name}`), list, id);
    const product: Product = {
      ...input,
      slug,
      id: existing?.id ?? uid(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    write(LS.products, existing ? list.map((p) => (p.id === id ? product : p)) : [product, ...list]);
    return product;
  },
  async deleteProduct(id) {
    write(LS.products, read<Product[]>(LS.products, seedProducts).filter((p) => p.id !== id));
  },
  async uploadImage(file) {
    return blobToDataUrl(await compressImage(file, 1000, 0.8));
  },
  async createBooking(input) {
    const b: Booking = { ...input, id: uid(), status: 'new', createdAt: new Date().toISOString() };
    write(LS.bookings, [b, ...read<Booking[]>(LS.bookings, [])]);
    return b;
  },
  async listBookings() {
    return read<Booking[]>(LS.bookings, []);
  },
  async setBookingStatus(id, status) {
    write(LS.bookings, read<Booking[]>(LS.bookings, []).map((b) => (b.id === id ? { ...b, status } : b)));
  },
  async deleteBooking(id) {
    write(LS.bookings, read<Booking[]>(LS.bookings, []).filter((b) => b.id !== id));
  },
  async createOrder(input) {
    const o: Order = { ...input, id: uid(), status: 'new', createdAt: new Date().toISOString() };
    write(LS.orders, [o, ...read<Order[]>(LS.orders, [])]);
    return o;
  },
  async listOrders() {
    return read<Order[]>(LS.orders, []);
  },
  async setOrderStatus(id, status) {
    write(LS.orders, read<Order[]>(LS.orders, []).map((o) => (o.id === id ? { ...o, status } : o)));
  },
  async deleteOrder(id) {
    write(LS.orders, read<Order[]>(LS.orders, []).filter((o) => o.id !== id));
  },
  async signIn(email, password) {
    if (email.trim().toLowerCase() !== DEMO_ADMIN.email || password !== DEMO_ADMIN.password)
      throw new Error('بيانات الدخول غير صحيحة');
    try { sessionStorage.setItem(LS.admin, '1'); } catch { /* التخزين غير متاح */ }
  },
  async signOut() {
    try { sessionStorage.removeItem(LS.admin); } catch { /* التخزين غير متاح */ }
  },
  async isAdmin() {
    try { return sessionStorage.getItem(LS.admin) === '1'; } catch { return false; }
  },
};

/* ------------------------------------------------------------------ */
/*  Supabase                                                            */
/* ------------------------------------------------------------------ */
type Row = Record<string, unknown>;

const toProduct = (r: Row): Product => ({
  id: r.id as string,
  slug: r.slug as string,
  name: r.name as string,
  brand: (r.brand as string) ?? '',
  category: r.category as Product['category'],
  price: Number(r.price),
  oldPrice: r.old_price == null ? null : Number(r.old_price),
  description: (r.description as string) ?? '',
  specs: (r.specs as Product['specs']) ?? [],
  colors: (r.colors as string[]) ?? [],
  images: (r.images as string[]) ?? [],
  stock: Number(r.stock ?? 0),
  featured: Boolean(r.featured),
  isNew: Boolean(r.is_new),
  createdAt: r.created_at as string,
});

const fromProduct = (p: ProductInput & { slug: string }) => ({
  slug: p.slug,
  name: p.name,
  brand: p.brand,
  category: p.category,
  price: Math.round(p.price),
  old_price: p.oldPrice ? Math.round(p.oldPrice) : null,
  description: p.description,
  specs: p.specs,
  colors: p.colors,
  images: p.images,
  stock: Math.round(p.stock),
  featured: p.featured,
  is_new: p.isNew,
});

const toBooking = (r: Row): Booking => ({
  id: r.id as string,
  name: r.name as string,
  phone: r.phone as string,
  device: r.device as string,
  service: r.service as string,
  issue: (r.issue as string) ?? '',
  date: (r.date as string) ?? '',
  time: (r.time as string) ?? '',
  status: r.status as BookingStatus,
  createdAt: r.created_at as string,
});

const toOrder = (r: Row): Order => ({
  id: r.id as string,
  customerName: r.customer_name as string,
  phone: r.phone as string,
  address: r.address as string,
  notes: (r.notes as string) ?? '',
  items: (r.items as Order['items']) ?? [],
  total: Number(r.total),
  status: r.status as OrderStatus,
  createdAt: r.created_at as string,
});

const check = <T,>(res: { data: T; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data;
};

const supabaseRepo: DataRepo = {
  mode: 'supabase',
  async listProducts() {
    const sb = await getSupabase();
    const rows = check(await sb.from('products').select('*').order('created_at', { ascending: false }));
    return (rows as Row[]).map(toProduct);
  },
  async saveProduct(input, id) {
    const sb = await getSupabase();
    const all = (check(await sb.from('products').select('id,slug')) as Row[]).map((r) => ({ id: r.id, slug: r.slug })) as Product[];
    const slug = uniqueSlug(input.slug || slugify(`${input.brand} ${input.name}`), all, id);
    const payload = fromProduct({ ...input, slug });
    const res = id
      ? await sb.from('products').update(payload).eq('id', id).select().single()
      : await sb.from('products').insert(payload).select().single();
    return toProduct(check(res) as Row);
  },
  async deleteProduct(id) {
    const sb = await getSupabase();
    check(await sb.from('products').delete().eq('id', id));
  },
  async uploadImage(file) {
    const sb = await getSupabase();
    const blob = await compressImage(file);
    const ext = blob.type === 'image/webp' ? 'webp' : file.name.split('.').pop() || 'jpg';
    const path = `${new Date().getFullYear()}/${uid()}.${ext}`;
    const { error } = await sb.storage.from(PRODUCT_BUCKET).upload(path, blob, {
      contentType: blob.type || file.type,
      cacheControl: '31536000',
    });
    if (error) throw new Error(error.message);
    return sb.storage.from(PRODUCT_BUCKET).getPublicUrl(path).data.publicUrl;
  },
  async createBooking(input) {
    const sb = await getSupabase();
    const id = uid();
    // لا نطلب select بعد الإدخال لأن الزائر لا يملك صلاحية القراءة (RLS)
    check(await sb.from('bookings').insert({ id, ...input }));
    return { ...input, id, status: 'new', createdAt: new Date().toISOString() };
  },
  async listBookings() {
    const sb = await getSupabase();
    return (check(await sb.from('bookings').select('*').order('created_at', { ascending: false })) as Row[]).map(toBooking);
  },
  async setBookingStatus(id, status) {
    const sb = await getSupabase();
    check(await sb.from('bookings').update({ status }).eq('id', id));
  },
  async deleteBooking(id) {
    const sb = await getSupabase();
    check(await sb.from('bookings').delete().eq('id', id));
  },
  async createOrder(input) {
    const sb = await getSupabase();
    const id = uid();
    check(
      await sb.from('orders').insert({
        id,
        customer_name: input.customerName,
        phone: input.phone,
        address: input.address,
        notes: input.notes ?? '',
        items: input.items,
        total: input.total,
      }),
    );
    return { ...input, id, status: 'new', createdAt: new Date().toISOString() };
  },
  async listOrders() {
    const sb = await getSupabase();
    return (check(await sb.from('orders').select('*').order('created_at', { ascending: false })) as Row[]).map(toOrder);
  },
  async setOrderStatus(id, status) {
    const sb = await getSupabase();
    check(await sb.from('orders').update({ status }).eq('id', id));
  },
  async deleteOrder(id) {
    const sb = await getSupabase();
    check(await sb.from('orders').delete().eq('id', id));
  },
  async signIn(email, password) {
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error('بيانات الدخول غير صحيحة');
    if (!(await supabaseRepo.isAdmin())) {
      await sb.auth.signOut();
      throw new Error('هذا الحساب لا يملك صلاحية الإدارة');
    }
  },
  async signOut() {
    const sb = await getSupabase();
    await sb.auth.signOut();
  },
  async isAdmin() {
    const sb = await getSupabase();
    const { data } = await sb.auth.getSession();
    if (!data.session) return false;
    const { data: ok } = await sb.rpc('is_admin');
    return ok === true;
  },
};

export const repo: DataRepo = isSupabaseConfigured ? supabaseRepo : localRepo;
