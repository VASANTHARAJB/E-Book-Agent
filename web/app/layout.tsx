import type { Metadata, Viewport } from "next";
import "./globals.css";

const name = process.env.NEXT_PUBLIC_APP_NAME || "E-Book Agent";

export const metadata: Metadata = {
  title: `${name}: create a complete ebook from one idea`,
  description:
    "Give E-Book Agent a topic. It writes an editable Word and PDF book, with optional AI pictures and illustrated story books, plus a landing page and launch plan.",
  icons: { icon: "/logo-icon.png", apple: "/logo.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
