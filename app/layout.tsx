import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://notator.online"),
  title: "Notator Web — Atari ST MIDI Sequencer Community",
  description:
    "Play, share, and archive Notator SL .SON files with the Atari ST community. Upload your songs, discover music, and connect with fellow Notator users.",
  keywords: [
    "Notator",
    "Notator SL",
    "Creator",
    "Atari ST",
    "MIDI sequencer",
    "Web MIDI",
    ".SON files",
    "music",
    "retro",
    "community",
    "archive",
  ],
  openGraph: {
    title: "Notator Web — Atari ST MIDI Sequencer Community",
    description:
      "Play, share, and archive Notator SL .SON files with the Atari ST community.",
    url: "https://notator.online",
    siteName: "Notator Web",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Notator Web — Atari ST MIDI Sequencer Community",
    description:
      "Play, share, and archive Notator SL .SON files with the Atari ST community.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
