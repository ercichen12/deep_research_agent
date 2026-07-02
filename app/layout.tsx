import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Heavy Console",
  description: "Internal Apodex Heavy-style research console"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
