// demo page: the current abilities section next to four alternative layouts, same live data
// Usage Syntax: served at "/demo/abilities/<characters.id>", e.g. /demo/abilities/4 (test site only, not linked)
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Constants
//     OPTIONS
//   Page
//     AbilityDemoPage
//--------------------------------------------------------------------------------------------------------------

"use client";

import Link from "next/link";
import { useParams } from "next/navigation"; //reads [id] from the URL
import { fetchCharacterDetail, type SheetAbility } from "@/lib/data";
import { useLive } from "@/lib/useLive";
import { useCharacterTheme } from "@/lib/themes"; //character palette, same as the real page
import { AbilitiesArray } from "@/components/SheetSections"; //current version, for comparison
import { DotStrips, LuckBars, LuckHex, StatBlock } from "@/components/AbilityOptions";

//--------------------------------------------------------------------------------------------------------------
//Constants
//--------------------------------------------------------------------------------------------------------------

//letter, name, one-line pitch, component
const OPTIONS: [string, string, string, (p: { abilities: SheetAbility[] }) => React.ReactElement][] = [
  ["A", "Luck bars", "Same look as the skill chart: bar grows right when the ability rolls lucky, left when unlucky.", LuckBars],
  ["B", "Dot strips", "Where the average d20 lands on a 1–20 track, with the fair line and the highest roll.", DotStrips],
  ["C", "Stat block", "Reads like a character sheet: big score and modifier, small luck gauge underneath.", StatBlock],
  ["D", "Luck hexagon", "One spoke per ability; the shape bulges past the dashed ring where the dice ran hot.", LuckHex],
];

//--------------------------------------------------------------------------------------------------------------
//Page
//--------------------------------------------------------------------------------------------------------------

// current section first, then options A-D, each in its own card
//output: JSX.Element
export default function AbilityDemoPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useLive(() => fetchCharacterDetail(Number(id)), [id]);
  useCharacterTheme(data?.card.name);
  const abilities = data?.sheet?.abilities;

  return (
    <>
      <Link href={`/character/${id}`} className="back-link">← Back to the character page</Link>
      <section className="hero" style={{ marginTop: 20 }}>
        <span className="eyebrow">Ability display options</span>
        <h1>{data?.card.name ?? "…"}</h1>
        <p>The current section first, then four alternatives built from the same numbers.</p>
      </section>
      {abilities && (
        <div style={{ display: "grid", gap: 20 }}>
          <div>
            <h2 className="opt-title">Current</h2>
            <AbilitiesArray abilities={abilities} />
          </div>
          {OPTIONS.map(([k, name, pitch, Option]) => (
            <div key={k}>
              <h2 className="opt-title">{k}. {name}</h2>
              <p className="opt-pitch">{pitch}</p>
              <div className="card">
                <Option abilities={abilities} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
