import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sanovio Procurement Agent",
  description: "Hospital supply ordering assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
