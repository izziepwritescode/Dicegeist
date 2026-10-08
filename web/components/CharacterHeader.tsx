// character page header: splash art band with the name, class line and campaign / last roll in white
// Usage Syntax: <CharacterHeader card={detail.card} status={status} />
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Constants
//     ART (first name -> splash image)
//   Header
//     CharacterHeader
//   Helpers
//     splitName
//--------------------------------------------------------------------------------------------------------------

"use client";

import Link from "next/link"; //client-side navigation
import type { CharacterCard } from "@/lib/data";
import type { LiveStatus } from "@/lib/useLive"; //status union from the live hook
import { LiveBadge } from "./ui";

//--------------------------------------------------------------------------------------------------------------
//Constants
//--------------------------------------------------------------------------------------------------------------

//keyed by lowercase first name (same key as the palettes); files live in web/public/art
//standard size: 2134 x 656 px (Izzie's 4267 x 1312 drafts at half size), art on the right, plain left for the text
const ART: Record<string, string> = {
  lazlo: "/art/lazlo.jpg",
  vasha: "/art/vasha.jpg",
  idris: "/art/idris.jpg",
  ivan: "/art/ivan.jpg",
};

//--------------------------------------------------------------------------------------------------------------
//Header
//--------------------------------------------------------------------------------------------------------------

// splash band; characters without art get a tinted placeholder from their own ramp
//params: card (CharacterCard); status (LiveStatus) - live badge state
//output: JSX.Element
export function CharacterHeader({ card, status }: { card: CharacterCard; status: LiveStatus }) {
  const [first, rest] = splitName(card.name);
  const art = ART[first.toLowerCase()];
  const classLine = [card.subclass, card.className].filter(Boolean).join(" ") + (card.level ? ` · Lvl ${card.level}` : "");
  const lastRoll = card.lastRollAt
    ? new Date(card.lastRollAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) //July 17, 2025
    : null;

  return (
    <header className={`char-head ${art ? "has-art" : "no-art"}`} style={art ? { backgroundImage: `url(${art})` } : undefined}>
      <div className="char-head-top">
        <Link href="/" className="char-head-back">← All characters</Link>
        <LiveBadge status={status} />
      </div>
      <div className="char-head-name">
        <h1>{first}</h1>
        <div className="char-head-side">
          {rest && <div className="char-head-last">{rest}</div>}
          {classLine.trim() && <div className="char-head-class">{classLine}</div>}
        </div>
      </div>
      <div className="char-head-meta">
        {card.campaign && <span>Campaign: {card.campaign}</span>}
        {lastRoll && <span>Last roll: {lastRoll}</span>}
      </div>
    </header>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Helpers
//--------------------------------------------------------------------------------------------------------------

// "Lazlo Remény-Benedek" -> ["Lazlo", "Remény-Benedek"]; one-word names -> [name, ""]
//params: name (string)
//output: [string, string]
function splitName(name: string): [string, string] {
  const i = name.indexOf(" ");
  return i < 0 ? [name, ""] : [name.slice(0, i), name.slice(i + 1)];
}
