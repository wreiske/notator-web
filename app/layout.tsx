import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import { TitleBar } from "@/components/ui/TitleBar";
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
  title: "Notator Online — Atari ST MIDI Sequencer Community",
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
    title: "Notator Online — Atari ST MIDI Sequencer Community",
    description:
      "Play, share, and archive Notator SL .SON files with the Atari ST community.",
    url: "https://notator.online",
    siteName: "Notator Online",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Notator Online — Atari ST MIDI Sequencer Community",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col h-screen overflow-hidden`}
      >
        <TitleBar />
        <main className="flex-1 overflow-y-auto">
          <Providers>{children}</Providers>
        </main>
      </body>
    </html>
  );
}
