// home page: one card per public character, live headline stats
// Usage Syntax: served at "/"
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Page
//     Home
//     totalRolls
//   Pieces
//     CharacterTile
//     Totals
//--------------------------------------------------------------------------------------------------------------

"use client";

import Link from "next/link"; //client-side navigation
import { motion } from "motion/react"; //staggered card entrance + hover lift
import { fetchCharacters, type CharacterCard } from "@/lib/data"; //Supabase reads
import { useLive } from "@/lib/useLive"; //auto-refresh on new rolls
import { CountUp, FAIR_D20, LiveBadge, LuckMeter } from "@/components/ui";
import { D20Counter } from "@/components/D20Counter"; //hero die with total roll count

//--------------------------------------------------------------------------------------------------------------
//Page
//--------------------------------------------------------------------------------------------------------------

// list view; cards animate in one after another
//output: JSX.Element
export default function Home() {
  const { data, status, error, pulse } = useLive(fetchCharacters, []);

  return (
    <>
      <section className="hero hero-row">
        <D20Counter value={data ? totalRolls(data) : null} />
        <div>
          <div style={{ display: "flex", gap: 10, rowGap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="eyebrow">Every roll, every session</span>
            <LiveBadge status={status} />
          </div>
          <h1>Are my dice cursed?</h1>
          <p>
            Dice rolls bulk-imported from online D&amp;D sessions, crunched per character and per skill. A fair d20
            averages 10.5; anything else is the dice gods playing favourites.
          </p>
        </div>
      </section>

      {error && <div className="card empty">Could not load rolls: {error}</div>}
      {!data && !error && (
        <div className="card empty" aria-busy="true">
          <p>Gathering rolls…</p>
        </div>
      )}

      {data && data.length === 0 && (
        <div className="card empty">
          <h2>No public characters yet</h2>
          <p>Characters show up here once they are marked public in the database.</p>
        </div>
      )}

      {data && data.length > 0 && (
        <>
          <Totals rows={data} pulse={pulse} />
          <motion.div
            className="grid-cards"
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.08 } } }} //each child starts 80ms after the last
          >
            {data.map((c) => (
              <CharacterTile key={c.id} c={c} />
            ))}
          </motion.div>
        </>
      )}
    </>
  );
}

// sum of roll_count across visible characters; same number the hero die counts to
//params: rows (CharacterCard[])
//output: number
function totalRolls(rows: CharacterCard[]): number {
  return rows.reduce((a, r) => a + r.rollCount, 0);
}

//--------------------------------------------------------------------------------------------------------------
//Pieces
//--------------------------------------------------------------------------------------------------------------

// one character card linking to its detail page
//params: c (CharacterCard)
//output: JSX.Element
function CharacterTile({ c }: { c: CharacterCard }) {
  const delta = c.avgD20 === null ? null : c.avgD20 - FAIR_D20;
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
    >
      <Link href={`/character/${c.id}`} className="card card-link">
        <div className="eyebrow">{[c.className, c.campaign].filter(Boolean).join(" · ") || "Adventurer"}</div>
        <h2 style={{ fontSize: "1.5rem", margin: "4px 0 14px" }}>{c.name}</h2>

        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span className="stat-value" style={{ margin: 0 }}>
            {c.avgD20 === null ? "–" : <CountUp value={c.avgD20} decimals={2} />}
          </span>
          <span style={{ color: "var(--ink-2)", fontSize: "0.85rem" }}>
            avg d20
            {delta !== null && ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} vs fair`}
          </span>
        </div>
        <LuckMeter avg={c.avgD20} />

        <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: "0.85rem", color: "var(--ink-2)" }}>
          <span><strong style={{ color: "var(--ink)" }}>{c.rollCount.toLocaleString()}</strong> rolls</span>
          <span><strong style={{ color: "var(--ink)" }}>{c.nat20s}</strong> nat 20s</span>
          <span><strong style={{ color: "var(--ink)" }}>{c.nat1s}</strong> nat 1s</span>
        </div>
      </Link>
    </motion.div>
  );
}

// totals across all characters (total rolls lives in the hero die); flashes when a live refresh lands
//params: rows (CharacterCard[]); pulse (number) - refresh counter from useLive
//output: JSX.Element
function Totals({ rows, pulse }: { rows: CharacterCard[]; pulse: number }) {
  const d20s = rows.reduce((a, r) => a + r.d20Count, 0);
  const n20 = rows.reduce((a, r) => a + r.nat20s, 0);
  const n1 = rows.reduce((a, r) => a + r.nat1s, 0);
  return (
    <div className="stats-row">
      {[
        ["d20s rolled", d20s],
        ["Natural 20s", n20],
        ["Natural 1s", n1],
      ].map(([label, v]) => (
        <div className="card" style={{ position: "relative" }} key={label as string}>
          {pulse > 0 && <span key={pulse} className="flash-ring flash" aria-hidden />}
          <div className="eyebrow">{label}</div>
          <div className="stat-value"><CountUp value={v as number} /></div>
        </div>
      ))}
    </div>
  );
}
