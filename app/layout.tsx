import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "ELOS 4D — O cronograma vivo na sua modelagem 3D",
  description:
    "Egtc Lean Operational System 4D. Carregue projetos IFC, importe seu cronograma e veja a obra acontecer em 4D.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="dark">
      <body>
        {children}
        <Toaster richColors position="top-right" theme="dark" />
      </body>
    </html>
  );
}
