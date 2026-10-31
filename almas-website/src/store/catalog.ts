import { useEffect } from 'react';
import { create } from 'zustand';
import { repo } from '@/lib/repo';
import type { Product } from '@/types';

interface CatalogState {
  products: Product[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  load: (force?: boolean) => Promise<void>;
}

export const useCatalog = create<CatalogState>((set, get) => ({
  products: [],
  status: 'idle',
  load: async (force = false) => {
    if (!force && (get().status === 'loading' || get().status === 'ready')) return;
    set({ status: get().products.length ? 'ready' : 'loading' });
    try {
      const products = await repo.listProducts();
      set({ products, status: 'ready', error: undefined });
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
    }
  },
}));

/** يحمّل المنتجات عند أول استخدام */
export function useProducts() {
  const state = useCatalog();
  useEffect(() => {
    void useCatalog.getState().load();
  }, []);
  return state;
}
