import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vox — Ambient AI Voice Assistant",
  description:
    "A continuous, interruptible AI voice assistant with Jev-powered model routing.",
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
