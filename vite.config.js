import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * ⚠️ `__BUILD_ID__` — تاریخ و ساعتِ ساختِ همین باندل، تزریق‌شده هنگامِ build.
 *
 * چرا لازم شد: وقتی کاربر از خطا اسکرین‌شات می‌فرستد، اولین سؤال همیشه این
 * است که «اصلاً نسخهٔ تازه دستش رسیده یا هنوز باندلِ قدیمی را می‌بیند؟» —
 * و تا حالا هیچ راهی برای جواب‌دادن نبود جز حدس‌زدن از روی ساعتِ گوشی.
 * حالا خودِ صفحهٔ خطا شمارهٔ نسخه را نشان می‌دهد و یک عکس کافی است.
 *
 * از `Date` استفاده می‌کند نه از git sha: در ساختِ داکرِ Coolify مخزنِ git
 * لزوماً در دسترس نیست، ولی ساعت همیشه هست.
 */
const buildId = new Date().toISOString();
export default defineConfig({
  plugins: [react(), { name: 'build-version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) }); } }],
  define: {
    __BUILD_ID__: JSON.stringify(
      buildId,
    ),
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
});
