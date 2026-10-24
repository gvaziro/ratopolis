import type { Metadata, Viewport } from "next";
import { Cormorant_SC, PT_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Cormorant_SC({
  variable: "--font-display",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
});

const body = PT_Sans({
  variable: "--font-body",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Ratropolis Underground | Крысиный мегаполис",
  description:
    "Инкрементальная игра: крысиная стимпанк-цивилизация под викторианским городом. Тащи крошки, строй мастерские и встречай поезда.",
};

export const viewport: Viewport = {
  themeColor: "#14110f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
