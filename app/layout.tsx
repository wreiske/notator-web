import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Notator Web — Atari ST MIDI Sequencer in the Browser",
  description:
    "Play and explore Notator SL .SON files directly in your browser using Web MIDI and Web Audio. A modern tribute to the legendary Atari ST sequencer.",
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
  ],
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
        {children}
      </body>
    </html>
  );
}
