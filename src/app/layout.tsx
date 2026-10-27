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

const DESCRIPTION = "Инкрементальная игра: крысиная стимпанк-цивилизация под викторианским городом. Тащи крошки, строй мастерские и встречай поезда.";

/**
 * Where the site lives (absolute URLs for the link preview): NEXT_PUBLIC_SITE_URL (a static export, e.g.
 * https://gvaziro.github.io/ratopolis), else the Vercel production domain, else local dev.
 */
const SITE = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
);
/** The static export's sub-path ("/ratopolis") or "" at the domain root (next.config passes BASE_PATH through). */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** A file in public/ as the page links it: <link> hrefs are not given the base path by Next, so it is added here. */
const asset = (path: string) => `${BASE}/${path}`;
/**
 * og:image wants an absolute URL. Built from the site's origin and the base-path'd file, never joined to
 * metadataBase: a NEXT_PUBLIC_SITE_URL that already ends in the base path would double it.
 */
const absolute = (path: string) => new URL(asset(path), SITE.origin).href;
const OG_IMAGE = { url: absolute("icons/og.png"), width: 1200, height: 630, alt: "Ratropolis Underground — Крысиный мегаполис" };

export const metadata: Metadata = {
  metadataBase: SITE,
  title: "Ratropolis Underground | Крысиный мегаполис",
  description: DESCRIPTION,
  applicationName: "Ratropolis",
  // SHL-6: static files (public/icons) instead of generated image routes, so a static export works under a sub-path
  icons: {
    icon: [
      { url: asset("icons/icon.svg"), type: "image/svg+xml" },
      { url: asset("icons/icon-192.png"), sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: asset("icons/apple-touch-icon.png"), sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "Ratropolis Underground",
    title: "Ratropolis Underground — Крысиный мегаполис",
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ratropolis Underground — Крысиный мегаполис",
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export const viewport: Viewport = {
  themeColor: "#14110f",
  // SHL-3: draw under the notch and the home indicator; the layout pads env(safe-area-inset-*) itself
  viewportFit: "cover",
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
