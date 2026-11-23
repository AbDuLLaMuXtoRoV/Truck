import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Smart Truck", template: "%s · Smart Truck" },
  description: "Smart Truck: issues and messages from Telegram in one simple place.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

/** Sets <html lang> from the stored language before first paint. */
const BOOT = `(function(){try{var l=localStorage.getItem("smart-truck.lang");if(l==="ru"||l==="en")document.documentElement.lang=l;}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uz-Latn" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
