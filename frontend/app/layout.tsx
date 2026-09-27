import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '暖归 · 宠物善终服务平台',
  description: '宠物善终预约、告别仪式与骨灰寄存全流程协同平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
