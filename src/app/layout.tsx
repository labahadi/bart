import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

export const metadata: Metadata = {
  title: 'bart',
  description: 'Trade with verified students on your campus. No money, just swaps.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon-32.png', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'bart', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, themeColor: '#F6F4EF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap"
        />
      </head>
      <body>
        <div className="app">
          <AuthProvider>{children}</AuthProvider>
        </div>
      </body>
    </html>
  );
}
