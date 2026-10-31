import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import App from './App';
import './index.css';

/** نسخة المعاينة (صفحة Claude) تعمل داخل إطار مضمّن، لذا نستخدم توجيهاً داخل الذاكرة */
const Router = import.meta.env.VITE_PREVIEW ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
