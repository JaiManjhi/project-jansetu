import type { Metadata, Viewport } from "next";
import {
  Noto_Sans,
  Noto_Serif,
  Noto_Sans_Devanagari,
  Noto_Sans_Bengali,
  Noto_Sans_Oriya,
} from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { SiteFooter } from "@/components/ui/SiteFooter";

/**
 * DESIGN.md §3 — Noto, not Inter.
 *
 * Inter has no Devanagari, Bengali or Odia glyphs, and this app translates
 * reports into all three. Every translated report was rendering in whatever
 * fallback the reader's OS supplied. Noto covers all of them and is also what
 * the Government of India's Digital Brand Identity Manual requires.
 */
const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const notoSerif = Noto_Serif({
  variable: "--font-noto-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

/**
 * The Indic faces are NOT preloaded. They are needed only once a reader asks
 * for a translation, and JanSetu is used on rural connections where preloading
 * four families ahead of a first paint would be indefensible.
 */
const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

const notoBengali = Noto_Sans_Bengali({
  variable: "--font-noto-bengali",
  subsets: ["bengali"],
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
});

const notoOriya = Noto_Sans_Oriya({
  variable: "--font-noto-oriya",
  subsets: ["oriya"],
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
});

const fontVariables = [
  notoSans.variable,
  notoSerif.variable,
  notoDevanagari.variable,
  notoBengali.variable,
  notoOriya.variable,
].join(" ");

export const metadata: Metadata = {
  title: "JanSetu",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "JanSetu", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  description:
    "Report a local problem. It reaches the university best equipped to solve it.",
};

export const viewport: Viewport = {
  themeColor: "#1f3f77",
  width: "device-width",
  initialScale: 1,
};

// Typed explicitly rather than with Next's generated `LayoutProps<"/">` helper,
// so `npm run typecheck` works on a clean checkout — that global type only
// exists after a build has populated .next/types.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fontVariables} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
