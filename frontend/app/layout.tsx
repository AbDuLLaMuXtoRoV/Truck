import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Trucking Operations CRM", template: "%s · Trucking Operations CRM" },
  description: "Trucking Operations CRM: unified Telegram and Gmail inbox, 5-minute response SLA, escalations and issue resolution.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d14" },
  ],
};

/** Applies the stored theme and language before first paint (no flash of the wrong theme). */
const BOOT = `(function(){try{var d=document.documentElement,t=localStorage.getItem("smart-truck.theme");var k=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(k)d.classList.add("dark");d.style.colorScheme=k?"dark":"light";var l=localStorage.getItem("smart-truck.lang");if(l==="ru"||l==="en")d.lang=l;}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uz-Latn" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="min-h-screen bg-bg text-sm text-fg antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
