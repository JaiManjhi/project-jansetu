import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

// DESIGN.md §3 — Inter for UI/body, one distinct display face for section
// headers only. Fraunces is the doc's own suggestion; used at 20px and above.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

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
  themeColor: "#fafaf8",
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
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
