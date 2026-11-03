import type { ReactNode } from "react";

export const metadata = {
  title: "Telegram Harness",
  description: "承認してから公開する Telegram チャンネル管理",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          background: "#f4f1ea",
          color: "#1c1915",
          fontFamily: "Georgia, 'Hiragino Mincho ProN', serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
