import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuantPulse AI — Market intelligence",
  description: "Live market data, technical signals, and AI-assisted trading research.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "QuantPulse" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0c0a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
