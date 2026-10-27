import type { Metadata, Viewport } from "next";
import "./globals.css";

const name = process.env.NEXT_PUBLIC_APP_NAME || "Digital Product Studio";

export const metadata: Metadata = {
  title: `${name} — build a complete digital product from one idea`,
  description:
    "Give it a topic. A team of AI agents writes an editable ebook, a landing page, an ad strategy and a go-to-market playbook for you to review and publish.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
