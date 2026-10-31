export type CategoryId = 'phones' | 'tablets' | 'headphones' | 'chargers' | 'cases' | 'accessories';

export interface Spec {
  label: string;
  value: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: CategoryId;
  /** السعر بالدينار العراقي */
  price: number;
  oldPrice?: number | null;
  description: string;
  specs: Spec[];
  /** ألوان HEX متاحة */
  colors: string[];
  images: string[];
  stock: number;
  featured: boolean;
  isNew: boolean;
  createdAt: string;
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'slug'> & { slug?: string };

export type BookingStatus = 'new' | 'confirmed' | 'in_progress' | 'done' | 'cancelled';

export interface Booking {
  id: string;
  name: string;
  phone: string;
  device: string;
  service: string;
  issue: string;
  date: string;
  time: string;
  status: BookingStatus;
  createdAt: string;
}

export type BookingInput = Omit<Booking, 'id' | 'createdAt' | 'status'>;

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  color?: string;
}

export type OrderStatus = 'new' | 'confirmed' | 'delivered' | 'cancelled';

export interface Order {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  notes?: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: string;
}

export type OrderInput = Omit<Order, 'id' | 'createdAt' | 'status'>;

export interface RepairService {
  id: string;
  title: string;
  description: string;
  startingPrice: number;
  duration: string;
  icon: 'screen' | 'battery' | 'port' | 'software' | 'water' | 'camera';
  points: string[];
}
