// per-skill luck: average natural d20 per skill, drawn as a bar left/right of the fair 10.5 line
// Usage Syntax: <SkillChart skills={detail.skills} />
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Constants
//     MIN_ROLLS
//   Chart
//     SkillChart
//--------------------------------------------------------------------------------------------------------------

"use client";

import { motion } from "motion/react"; //bar grow-in animation
import { useState } from "react";
import type { SkillStat } from "@/lib/data";
import { FAIR_D20 } from "./ui";

//--------------------------------------------------------------------------------------------------------------
//Constants
//--------------------------------------------------------------------------------------------------------------

const MIN_ROLLS = 5; //below this, an average is mostly noise -> bar drawn faded

//--------------------------------------------------------------------------------------------------------------
//Chart
//--------------------------------------------------------------------------------------------------------------

// diverging bars: blue right = luckier than fair, red left = unluckier
//params: skills (SkillStat[]) - sorted by roll count desc
//output: JSX.Element
export function SkillChart({ skills }: { skills: SkillStat[] }) {
  const [table, setTable] = useState(false);
  const rows = skills.filter((s) => s.avgD20 !== null);

  //symmetric scale around fair, at least ±2 so small differences do not look dramatic
  const span = Math.max(2, ...rows.map((s) => Math.abs((s.avgD20 ?? FAIR_D20) - FAIR_D20)));

  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2>Skill checks</h2>
          <p>Average natural d20 per skill, before modifiers. Centre line = fair 10.5.</p>
        </div>
        <button className="toggle" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>

      {rows.length === 0 && <p style={{ color: "var(--ink-2)" }}>No skill or ability checks yet.</p>}

      {table ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Skill</th><th>Rolls</th><th>Avg d20</th><th>Avg total</th><th>Nat 20</th><th>Nat 1</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.code ?? "none"}>
                  <td>{s.name}</td>
                  <td>{s.rollCount}</td>
                  <td>{s.avgD20?.toFixed(2)}</td>
                  <td>{s.avgTotal?.toFixed(2) ?? "–"}</td>
                  <td>{s.nat20s}</td>
                  <td>{s.nat1s}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {rows.map((s, i) => {
            const delta = (s.avgD20 ?? FAIR_D20) - FAIR_D20;
            const w = (Math.abs(delta) / span) * 50; //% of track; half the track each side
            const thin = s.rollCount < MIN_ROLLS;
            return (
              <div
                key={s.code ?? "none"}
                style={{ display: "grid", gridTemplateColumns: "minmax(90px, 140px) 1fr 52px", gap: 10, alignItems: "center", fontSize: "0.85rem" }}
                title={`${s.name}: avg d20 ${s.avgD20?.toFixed(2)} over ${s.rollCount} rolls`}
              >
                <span style={{ color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name} <span style={{ color: "var(--ink-muted)" }}>({s.rollCount})</span>
                </span>
                <div style={{ position: "relative", height: 18 }}>
                  <div style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: "var(--ink-muted)" }} />
                  <motion.div
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }} //animate when scrolled into view
                    viewport={{ once: true }}
                    transition={{ duration: 0.7, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                    style={{
                      position: "absolute",
                      top: 2,
                      bottom: 2,
                      left: delta >= 0 ? "50%" : `${50 - w}%`,
                      width: `${w}%`,
                      background: delta >= 0 ? "var(--above)" : "var(--below)",
                      opacity: thin ? 0.4 : 1,
                      borderRadius: delta >= 0 ? "0 4px 4px 0" : "4px 0 0 4px", //round the data end only
                      transformOrigin: delta >= 0 ? "left" : "right",
                    }}
                  />
                </div>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.avgD20?.toFixed(2)}</span>
              </div>
            );
          })}
          <div className="legend">
            <span><i style={{ background: "var(--above)" }} />Luckier than fair</span>
            <span><i style={{ background: "var(--below)" }} />Unluckier than fair</span>
            <span><i style={{ background: "var(--ink-muted)", opacity: 0.4 }} />Faded: under {MIN_ROLLS} rolls</span>
          </div>
        </div>
      )}
    </div>
  );
}
