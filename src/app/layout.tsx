import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeInitScript, ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Per-page titles fill the `%s`; pages without their own title fall back to
  // the bare default. e.g. recipe page → "Lasagne · nomly".
  title: {
    default: "nomly",
    template: "%s · nomly",
  },
  description: "Kochbuch, Mahlzeitenplaner und Einkaufsliste",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E1721F" },
    { media: "(prefers-color-scheme: dark)",  color: "#E1721F" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <ThemeInitScript />
      </head>
      <body className="min-h-full">
        {/* The app chrome (nav, service worker, pull-to-refresh) lives in the
            (app) route group's layout. The root layout stays minimal so the
            embed routes (Home Assistant recipe iframe) render bare. */}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
