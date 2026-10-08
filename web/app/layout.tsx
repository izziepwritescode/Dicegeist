// root layout: fonts, footer, demo banner; wraps every page
// Usage Syntax: picked up automatically by Next.js (app router)
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Fonts
//     inter / fraunces
//   Metadata
//     metadata
//   Layout
//     RootLayout
//--------------------------------------------------------------------------------------------------------------

import type { Metadata } from "next"; //page <head> typing
import { Bebas_Neue, Fraunces, Inter } from "next/font/google"; //self-hosted Google fonts, no layout shift
import { MotionRoot } from "@/components/MotionRoot"; //honours OS reduce-motion for every animation
import { isDemo } from "@/lib/data"; //true when Supabase env vars are missing
import "./globals.css";

//--------------------------------------------------------------------------------------------------------------
//Fonts (exposed as CSS variables, used in globals.css)
//--------------------------------------------------------------------------------------------------------------

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const bebas = Bebas_Neue({ variable: "--font-poster", weight: "400", subsets: ["latin", "latin-ext"] }); //tall condensed caps, character page names

//--------------------------------------------------------------------------------------------------------------
//Metadata (browser tab + link previews on socials)
//--------------------------------------------------------------------------------------------------------------

export const metadata: Metadata = {
  title: { default: "Calculated Strike", template: "%s · Calculated Strike" },
  description: "Live D&D dice statistics: every roll from every session, crunched.",
  openGraph: { title: "Calculated Strike", description: "Live D&D dice statistics: every roll from every session, crunched." },
};

//--------------------------------------------------------------------------------------------------------------
//Layout
//--------------------------------------------------------------------------------------------------------------

// shell shared by all pages
//params: children (React.ReactNode) - current page
//output: JSX.Element - <html> document
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${bebas.variable}`}>
      <body>
        {isDemo && (
          <div className="demo-banner">
            Demo data. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to show real rolls.
          </div>
        )}
        <MotionRoot>
          <main className="shell">{children}</main>
        </MotionRoot>
        <footer className="site-footer shell">
          Built by Izzie · rolls imported from Roll20 and Foundry VTT · data live from Supabase
        </footer>
      </body>
    </html>
  );
}
