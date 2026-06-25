import type { Metadata } from "next";
import "./globals.css";
import Nav from "./_components/Nav";

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
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
