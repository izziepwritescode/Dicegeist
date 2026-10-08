// character page: headline tiles, abilities, attacks, damage, spells, play nights, d20 faces, skills; all live
// Usage Syntax: served at "/character/<characters.id>", e.g. /character/1
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Page
//     CharacterPage
//--------------------------------------------------------------------------------------------------------------

"use client";

import Link from "next/link"; //client-side navigation
import { useParams } from "next/navigation"; //reads [id] from the URL
import { motion } from "motion/react"; //section stagger
import { fetchCharacterDetail } from "@/lib/data"; //Supabase reads
import { useLive } from "@/lib/useLive"; //auto-refresh on new rolls
import { FAIR_D20, LiveBadge, StatTile } from "@/components/ui";
import { FaceChart } from "@/components/FaceChart";
import { AbilitiesArray, AttackSplit, DamageByType, NightsChart, SheetKpis, SpellVsWeapon, SpellsCast } from "@/components/SheetSections"; //character_sheet() sections
import { SkillChart } from "@/components/SkillChart";
import { useCharacterTheme } from "@/lib/themes"; //character palette on the whole page

//--------------------------------------------------------------------------------------------------------------
//Page
//--------------------------------------------------------------------------------------------------------------

// detail view for one character; null result (private or missing) -> not-found card
//output: JSX.Element
export default function CharacterPage() {
  const { id } = useParams<{ id: string }>();
  const charId = Number(id);
  const { data, status, error, loaded } = useLive(() => fetchCharacterDetail(charId), [charId]);

  useCharacterTheme(data?.card.name); //page, header and charts take the character's ramp + accent

  const rise = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }; //shared entrance variant

  return (
    <>
      <Link href="/" className="back-link">← All characters</Link>

      {error && <div className="card empty" style={{ marginTop: 20 }}>Could not load rolls: {error}</div>}
      {!loaded && !error && (
        <div className="card empty" style={{ marginTop: 20 }} aria-busy="true"><p>Gathering rolls…</p></div>
      )}
      {loaded && !error && data === null && (
        <div className="card empty" style={{ marginTop: 20 }}>
          <h2>Character not found</h2>
          <p>It may be private or no longer exist.</p>
        </div>
      )}

      {data && (
        <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }}>
          <motion.section className="hero" variants={rise} style={{ marginTop: 20 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="eyebrow">{[data.card.className, data.card.campaign].filter(Boolean).join(" · ") || "Adventurer"}</span>
              <LiveBadge status={status} />
            </div>
            <h1>{data.card.name}</h1>
            {data.card.lastRollAt && (
              <p>Last roll {new Date(data.card.lastRollAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
            )}
          </motion.section>

          {data.sheet ? (
            <>
              <motion.div variants={rise}>
                <SheetKpis sheet={data.sheet} />
              </motion.div>
              <motion.div variants={rise}>
                <AbilitiesArray abilities={data.sheet.abilities} />
              </motion.div>
              <motion.div className="sheet-grid" variants={rise}>
                <div className="span-6">
                  <AttackSplit attacks={data.sheet.attacks} total={data.sheet.kpis.attacks} hits={data.sheet.kpis.hits} />
                </div>
                <div className="span-6">
                  <NightsChart nights={data.sheet.nights} />
                </div>
                <div className="span-7">
                  <DamageByType types={data.sheet.damageTypes} />
                </div>
                <div className="span-5">
                  <SpellVsWeapon total={data.sheet.kpis.damage} spell={data.sheet.kpis.spellDamage} damage={data.sheet.damage} />
                </div>
                <div className="span-12">
                  <SpellsCast levels={data.sheet.spellLevels} spells={data.sheet.spells} total={data.sheet.kpis.spellsCast} byLevel={data.sheet.kpis.platform === "roll20"} />
                </div>
              </motion.div>
            </>
          ) : (
            //character_sheet() not created yet -> the original four tiles
            <motion.div className="stats-row" variants={rise}>
              <StatTile
                label="Average d20"
                value={data.card.avgD20}
                decimals={2}
                sub={data.card.avgD20 === null ? undefined : `${data.card.avgD20 >= FAIR_D20 ? "+" : ""}${(data.card.avgD20 - FAIR_D20).toFixed(2)} vs fair 10.5`}
              />
              <StatTile label="Rolls" value={data.card.rollCount} sub={`${data.card.d20Count.toLocaleString()} with a d20`} />
              <StatTile label="Natural 20s" value={data.card.nat20s} tone="good" sub={pctOf(data.card.nat20s, data.card.d20Count)} />
              <StatTile label="Natural 1s" value={data.card.nat1s} tone="critical" sub={pctOf(data.card.nat1s, data.card.d20Count)} />
            </motion.div>
          )}

          <motion.div variants={rise} className="section">
            <FaceChart faces={data.faces} />
          </motion.div>
          <motion.div variants={rise} className="section">
            <SkillChart skills={data.skills} />
          </motion.div>
        </motion.div>
      )}
    </>
  );
}

// "x% of d20s (fair 5%)" helper for nat 1 / nat 20 tiles
//params: n (number) - count; d (number) - d20 total
//output: string
function pctOf(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(1)}% of d20s (fair 5%)` : "no d20s yet";
}
