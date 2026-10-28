import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "SOULBOUND", description: "A character that is verifiably alive." };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
