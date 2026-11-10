import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prela Stone Studio",
  description: "Plan marble slab cuts and match veins across assembled pieces.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
