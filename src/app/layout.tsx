import type { Metadata, Viewport } from "next";
import { PwaControls } from '@/components/pwa-controls';
import type { ReactNode } from "react";

import "./globals.css";
import '@/components/pwa-controls.css';

export const metadata: Metadata = {
  title: "家庭学习工具",
  description: "家庭听写、习惯与成长伙伴",
  applicationName: '家庭学习工具',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: '家庭学习' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#276851', width: 'device-width', initialScale: 1 };

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body>{children}<PwaControls /></body>
    </html>
  );
}
