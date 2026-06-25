import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Nav from "./_components/Nav";

// Inter for UI prose; JetBrains Mono for the data spine — scores, ranks,
// provenance chips, domains. Self-hosted by next/font (no runtime CDN), so the
// offline demo keeps working. Exposed as CSS vars consumed in globals.css.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Conference Compass",
  description:
    "Turn a conference's flat directory into a goal-ranked, sourced plan: who to meet and why.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
