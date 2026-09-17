import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/900.css';
import './index.css';
import App from './App.jsx';
/* ⚠️ **پیش از رندر** اعمال می‌شود، نه در یک افکت: اگر منتظرِ اولین رندر می‌ماند،
   کاربرِ تمِ روشن یک فریمِ کاملِ تیره می‌دید و بعد صفحه سفید می‌شد. */
import { applyTheme, applyDensity, resolveTheme, resolveDensity } from './lib/theme.js';
import VersionNotice from './ui/VersionNotice.jsx';

applyTheme(resolveTheme(null));
applyDensity(resolveDensity());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <VersionNotice />
    </BrowserRouter>
  </React.StrictMode>
);

// PWA — فقط در پروداکشن (تا dev server کش نشود)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
