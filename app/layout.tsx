import type { ReactNode } from "react";

export const metadata = {
  title: "Parkline",
  description: "Fleet and equipment management",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
