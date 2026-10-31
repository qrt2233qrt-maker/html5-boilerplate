import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { initSmoothScroll } from '@/lib/motion';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { CartDrawer } from '@/components/layout/CartDrawer';
import { WhatsAppFab } from '@/components/layout/WhatsAppFab';
import { PageTransition } from '@/components/layout/PageTransition';
import Home from '@/pages/Home';

const Store = lazy(() => import('@/pages/Store'));
const Product = lazy(() => import('@/pages/Product'));
const Cart = lazy(() => import('@/pages/Cart'));
const Maintenance = lazy(() => import('@/pages/Maintenance'));
const Contact = lazy(() => import('@/pages/Contact'));
const Admin = lazy(() => import('@/pages/Admin'));
const NotFound = lazy(() => import('@/pages/NotFound'));

function Loader() {
  return (
    <div className="grid min-h-screen place-items-center">
      <span className="h-10 w-10 animate-spin rounded-full border-2 border-volt-500/20 border-t-volt-500" />
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith('/admin');

  useEffect(() => {
    initSmoothScroll();
  }, []);

  if (isAdmin) {
    return (
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/admin/*" element={<Admin />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <>
      <Header />
      <main>
        <PageTransition>
          <Suspense fallback={<Loader />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/store" element={<Store />} />
              <Route path="/product/:slug" element={<Product />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/maintenance" element={<Maintenance />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </PageTransition>
      </main>
      <Footer />
      <CartDrawer />
      <WhatsAppFab />
    </>
  );
}
