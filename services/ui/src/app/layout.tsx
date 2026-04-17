import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider } from '@/core/theme/theme-provider';
import { ExecutionNotifier } from '@/components/system/ExecutionNotifier';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AI Engine',
  description: 'AI-powered document processing platform',
};

/**
 * Inline script that runs before React hydrates to apply the stored theme
 * without a flash of the default (dark) mode for light-mode users.
 */
const ANTI_FLASH_SCRIPT = `
(function(){
  try {
    var t = localStorage.getItem('theme') || 'dark';
    if (t === 'light' || (t === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)) {
      document.documentElement.classList.add('light');
    }
  } catch(e) {}
})();
`.trim();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* Runs synchronously before paint — eliminates theme flash */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
          <Toaster position="bottom-right" richColors />
          <ExecutionNotifier />
        </ThemeProvider>
      </body>
    </html>
  );
}
