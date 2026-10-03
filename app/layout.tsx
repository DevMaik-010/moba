import type { Metadata } from "next";
import { Chakra_Petch, Geist_Mono, Russo_One } from "next/font/google";
import "./globals.css";

// Russo One para títulos y marcadores, Chakra Petch para el texto: estética esports.
const heading = Russo_One({
  variable: "--font-heading",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const body = Chakra_Petch({
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sistemas MLBB — Torneos",
  description:
    "Organiza torneos de Mobile Legends 1v1, 3v3 y 5v5 con validación de IDs y cuadro en vivo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${heading.variable} ${body.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
