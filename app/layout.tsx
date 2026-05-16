import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wi-Fi da Base",
  description: "Acesso e cadastro para o Wi-Fi da Base",
  icons: {
    icon: "/brand/apple-icon.png",
    apple: "/brand/apple-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
