import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '@/types';

export interface CartLine {
  key: string;
  productId: string;
  slug: string;
  name: string;
  price: number;
  image?: string;
  category: Product['category'];
  color?: string;
  qty: number;
}

interface CartState {
  lines: CartLine[];
  open: boolean;
  add: (p: Product, qty?: number, color?: string) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      open: false,
      add: (p, qty = 1, color) =>
        set((s) => {
          const key = `${p.id}:${color ?? ''}`;
          const existing = s.lines.find((l) => l.key === key);
          const lines = existing
            ? s.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + qty, price: p.price } : l))
            : [
                ...s.lines,
                { key, productId: p.id, slug: p.slug, name: p.name, price: p.price, image: p.images[0], category: p.category, color, qty },
              ];
          return { lines, open: true };
        }),
      setQty: (key, qty) =>
        set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, qty: Math.max(1, Math.min(99, qty)) } : l)) })),
      remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
      clear: () => set({ lines: [] }),
      setOpen: (open) => set({ open }),
    }),
    { name: 'almaas.cart.v1', partialize: (s) => ({ lines: s.lines }) },
  ),
);

export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.qty, 0);
export const cartTotal = (lines: CartLine[]) => lines.reduce((n, l) => n + l.qty * l.price, 0);
