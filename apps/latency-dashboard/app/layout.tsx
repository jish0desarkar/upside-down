import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Latency Control Room",
  description:
    "Professional React dashboard for visualizing 6 hour endpoint latency averages.",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;
