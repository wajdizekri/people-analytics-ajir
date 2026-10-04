import type { Metadata, Viewport } from "next";
import { themeScript } from "@/components/ui/theme-script";
import { ThemeSync } from "@/components/ui/theme";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "People Analytics — AJIR",
  description: "Module d'aide à la décision RH intégré à AJIR",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

// data-theme / data-theme-pref sont posés par le script avant affichage (pas de flash) : suppressHydrationWarning sur <html>.
// Toaster monté ici (et non dans le gabarit de l'app) : un toast émis juste avant une redirection survit à la navigation.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-canvas text-fg">
        <ThemeSync />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
