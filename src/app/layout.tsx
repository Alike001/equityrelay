import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EquityRelay — Own the stock. We handle the rail.",
  description: "Use the tokenized stock you already hold in the BNB application you actually want.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
