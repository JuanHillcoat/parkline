import type { ReactNode } from "react";
import "./globals.css";
import { copy } from "./_lib/copy";

export const metadata = {
  title: copy.meta.title,
  description: copy.meta.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={copy.meta.lang}>
      <body>{children}</body>
    </html>
  );
}
