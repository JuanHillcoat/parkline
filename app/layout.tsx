import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { copy } from "./_lib/copy";

export const metadata = {
  title: copy.meta.title,
  description: copy.meta.description,
};

// Inter is downloaded at build time and served by the app itself: no request to a font service at runtime.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={copy.meta.lang} className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
