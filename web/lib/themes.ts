// colour palettes: main (home) + one per character; character themes override the CSS tokens in globals.css
// Usage Syntax: useCharacterTheme(name) on a page; themeVars(name) for a local style={...} override
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Palettes
//     MAIN (const) - sea-glass blues, home page
//     PALETTES (const) - 5-step ramp (dark -> light) + accent pair per character
//   Theme builders
//     paletteFor
//     themeVars
//     luminance
//   Hook
//     useCharacterTheme
//--------------------------------------------------------------------------------------------------------------

"use client";

import { useEffect } from "react"; //apply / undo theme on mount / unmount

//--------------------------------------------------------------------------------------------------------------
//Palettes (sampled from Izzie's palette sheet)
//--------------------------------------------------------------------------------------------------------------

export const MAIN = ["#d2e3ea", "#b2cfd5", "#9bbbc6"]; //light -> dark band, home page

export type Palette = {
  ramp: [string, string, string, string, string]; //c1 darkest .. c5 lightest
  accent: string; //light accent: key metrics on dark ramp surfaces (>= 3:1 on c1)
  accentDeep: string; //darker accent variant
};

//keyed by lowercase first name; characters without an entry fall back to the main theme
export const PALETTES: Record<string, Palette> = {
  lazlo: { ramp: ["#2c133b", "#482a5e", "#644678", "#8d71a1", "#a78eb8"], accent: "#a4eac6", accentDeep: "#91c8ab" }, //purple + mint
  vasha: { ramp: ["#421913", "#682920", "#934f44", "#b47d78", "#d8b1ac"], accent: "#417e6c", accentDeep: "#346051" }, //red + teal
  idris: { ramp: ["#11223e", "#223555", "#3e567a", "#586f91", "#90a3c1"], accent: "#d6ad6d", accentDeep: "#b3823d" }, //blue + gold
  ivan: { ramp: ["#30390a", "#46501b", "#5d6732", "#7d8755", "#9ca47b"], accent: "#c87c5a", accentDeep: "#a65a36" }, //green + orange
};

//--------------------------------------------------------------------------------------------------------------
//Theme builders
//--------------------------------------------------------------------------------------------------------------

// palette for a character name ("Idris Ildroun" -> idris)
//params: name (string | null | undefined)
//output: Palette | null
export function paletteFor(name: string | null | undefined): Palette | null {
  if (!name) return null;
  return PALETTES[name.split(/\s+/)[0].toLowerCase()] ?? null; //first word, lowercase -> key
}

// CSS custom properties for a character's dark, immersive theme; same token names as globals.css
//params: name (string | null | undefined)
//output: Record<string, string> - {} when no palette, so the main theme stays
export function themeVars(name: string | null | undefined): Record<string, string> {
  const p = paletteFor(name);
  if (!p) return {};
  const [c1, c2, c3, c4, c5] = p.ramp;
  return {
    "--page": c1,
    "--surface": c2,
    "--surface-2": c3,
    "--ink": "#ffffff",
    "--ink-2": c5,
    "--ink-muted": c5,
    "--grid": c3,
    "--axis": c4,
    "--accent": p.accent,
    "--accent-glow": `${p.accent}33`, //hex + 20% alpha
    "--metric": p.accent, //key numbers punched out in the accent
    "--bar": c4,
    "--above": p.accent,
    "--below": c4,
    "--good": p.accent,
    "--critical": "#e66767",
    "--accent-deep": p.accentDeep,
    "--on-accent": luminance(p.accent) > 0.25 ? c1 : "#ffffff", //text on accent fills: dark on mint / gold / orange, white on Vasha's teal
    "--c1": c1,
    "--c2": c2,
    "--c3": c3,
    "--c4": c4,
    "--c5": c5,
  };
}

// relative luminance of a #rrggbb colour (WCAG formula), 0 = black .. 1 = white
//params: hex (string)
//output: number
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; //undo sRGB gamma
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

//--------------------------------------------------------------------------------------------------------------
//Hook
//--------------------------------------------------------------------------------------------------------------

// put a character's theme on <html> while the page is open, so header, footer and page background follow it
//params: name (string | null | undefined) - character name; null -> main theme
//output: void
export function useCharacterTheme(name: string | null | undefined): void {
  useEffect(() => {
    const vars = themeVars(name);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.style.colorScheme = Object.keys(vars).length ? "dark" : "";
    //leaving the page -> drop the overrides, main theme returns
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
      root.style.colorScheme = "";
    };
  }, [name]);
}
