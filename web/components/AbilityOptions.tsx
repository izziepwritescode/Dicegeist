// four candidate layouts for the abilities section, shown side by side on /demo/abilities so Izzie can pick one
// Usage Syntax: <LuckBars abilities={sheet.abilities} /> (also DotStrips, StatBlock, LuckHex)
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Options
//     LuckBars    A - diverging bars around fair 10.5, score + rolls beside each
//     DotStrips   B - 1..20 track: avg d20 dot, fair tick, highest d20 end
//     StatBlock   C - D&D stat block row, small luck gauge under each score
//     LuckHex     D - hexagon: avg d20 per ability vs the fair 10.5 ring
//   Helpers
//     modText / luckText / FAIR
//--------------------------------------------------------------------------------------------------------------

"use client";

import { motion } from "motion/react"; //grow-in
import type { SheetAbility } from "@/lib/data";

const FAIR = 10.5; //fair d20 average
const THIN = 5; //fewer rolls -> average is noise, drawn faded
const EASE = [0.22, 1, 0.36, 1] as const;

//--------------------------------------------------------------------------------------------------------------
//Options
//--------------------------------------------------------------------------------------------------------------

// A: one row per ability; bar grows right (luckier, accent) or left (unluckier, ramp) from the fair line
//params: abilities (SheetAbility[]) - STR..CHA
//output: JSX.Element
export function LuckBars({ abilities }: { abilities: SheetAbility[] }) {
  const span = Math.max(2, ...abilities.filter((a) => a.rolls >= THIN).map((a) => Math.abs(a.avgD20! - FAIR))); //symmetric, at least ±2; thin rows can't stretch it
  return (
    <div className="opt-a">
      {abilities.map((a, i) => {
        const d = (a.avgD20 ?? FAIR) - FAIR;
        const w = Math.min(50, (Math.abs(d) / span) * 50); //% of track, half each side; a thin row runs to the edge at most
        return (
          <div key={a.code} className="opt-a-row" style={{ opacity: a.rolls < THIN ? 0.45 : 1 }}>
            <div className="opt-a-id">
              <b>{a.code}</b>
              <span>{a.score ?? "–"} · {modText(a.score)}</span>
            </div>
            <div className="opt-a-track">
              <i className="opt-a-mid" />
              {a.rolls > 0 && (
                <motion.i
                  className="opt-a-bar"
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: i * 0.05, ease: EASE }}
                  style={{
                    left: d >= 0 ? "50%" : `${50 - w}%`,
                    width: `${w}%`,
                    background: d >= 0 ? "var(--accent)" : "var(--c4)",
                    transformOrigin: d >= 0 ? "left" : "right",
                    borderRadius: d >= 0 ? "0 4px 4px 0" : "4px 0 0 4px", //round the data end only
                  }}
                />
              )}
            </div>
            <div className="opt-a-num">
              <b>{a.avgD20?.toFixed(1) ?? "–"}</b>
              <span>{a.rolls} rolls · total {a.avgTotal?.toFixed(1) ?? "–"}</span>
            </div>
          </div>
        );
      })}
      <div className="legend">
        <span><i style={{ background: "var(--accent)" }} />Luckier than fair 10.5</span>
        <span><i style={{ background: "var(--c4)" }} />Unluckier</span>
        <span><i style={{ background: "var(--ink-muted)", opacity: 0.45 }} />Faded: under {THIN} rolls</span>
      </div>
    </div>
  );
}

// B: 1..20 track per ability; dot = avg d20, tick = fair 10.5, faint bar out to the highest d20
//params: abilities (SheetAbility[])
//output: JSX.Element
export function DotStrips({ abilities }: { abilities: SheetAbility[] }) {
  const pos = (v: number) => ((v - 1) / 19) * 100; //1..20 -> 0..100%
  return (
    <div className="opt-b">
      {abilities.map((a, i) => (
        <div key={a.code} className="opt-b-row" style={{ opacity: a.rolls < THIN ? 0.45 : 1 }}>
          <div className="opt-a-id">
            <b>{a.code}</b>
            <span>{a.score ?? "–"} · {modText(a.score)}</span>
          </div>
          <div className="opt-b-track">
            <i className="opt-b-fair" style={{ left: `${pos(FAIR)}%` }} />
            {a.rolls > 0 && (
              <>
                <i className="opt-b-range" style={{ left: 0, width: `${pos(a.maxD20 ?? 1)}%` }} />
                <motion.i
                  className="opt-b-dot"
                  initial={{ left: `${pos(FAIR)}%`, opacity: 0 }}
                  whileInView={{ left: `${pos(a.avgD20!)}%`, opacity: 1 }} //slides out from fair to the average
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: i * 0.05, ease: EASE }}
                  style={{ background: a.avgD20! >= FAIR ? "var(--accent)" : "var(--c5)" }}
                  title={`${a.code}: avg d20 ${a.avgD20} over ${a.rolls} rolls, high ${a.maxD20}`}
                />
              </>
            )}
          </div>
          <div className="opt-a-num">
            <b>{a.avgD20?.toFixed(1) ?? "–"}</b>
            <span>{luckText(a)}</span>
          </div>
        </div>
      ))}
      <div className="opt-b-axis"><span>1</span><span>fair 10.5</span><span>20</span></div>
    </div>
  );
}

// C: classic stat-block row (score big, modifier in a pill); under each a small gauge, tick = fair
//params: abilities (SheetAbility[])
//output: JSX.Element
export function StatBlock({ abilities }: { abilities: SheetAbility[] }) {
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - 8.5) / 4) * 100)); //zoomed 8.5..12.5, same as the home luck meter
  return (
    <div className="opt-c">
      {abilities.map((a) => {
        const d = (a.avgD20 ?? FAIR) - FAIR;
        return (
          <div key={a.code} className="opt-c-cell" style={{ opacity: a.rolls < THIN ? 0.45 : 1 }}>
            <div className="opt-c-code">{a.code}</div>
            <div className="opt-c-score">{a.score ?? "–"}</div>
            <div className="opt-c-mod">{modText(a.score)}</div>
            <div className="opt-c-gauge">
              <i className="opt-c-fair" />
              {a.rolls > 0 && (
                <i
                  className="opt-c-fill"
                  style={{
                    left: `${Math.min(pos(a.avgD20!), 50)}%`,
                    width: `${Math.abs(pos(a.avgD20!) - 50)}%`,
                    background: d >= 0 ? "var(--accent)" : "var(--c4)",
                  }}
                />
              )}
            </div>
            <div className="opt-c-luck" style={{ color: d >= 0 ? "var(--accent)" : "var(--ink-2)" }}>
              {a.rolls ? `${d >= 0 ? "+" : ""}${d.toFixed(1)} luck` : "no rolls"}
            </div>
            <div className="opt-c-sub">{a.rolls} rolls · best {a.maxTotal ?? "–"}</div>
          </div>
        );
      })}
    </div>
  );
}

// D: hexagon, one spoke per ability (D&D stat-block shape); filled shape = avg d20, dashed ring = fair 10.5
//params: abilities (SheetAbility[])
//output: JSX.Element
export function LuckHex({ abilities }: { abilities: SheetAbility[] }) {
  const S = 300, C = S / 2, R = 110; //svg size, centre, outer radius
  const LO = 6, HI = 15; //radius scale in d20 units: centre = 6, rim = 15 (real averages sit near 10.5)
  const r = (v: number) => (Math.min(HI, Math.max(LO, v)) - LO) / (HI - LO) * R;
  const pt = (i: number, rad: number) => {
    const ang = -Math.PI / 2 + (i * Math.PI) / 3; //start at top, 60° per spoke
    return [C + rad * Math.cos(ang), C + rad * Math.sin(ang)];
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, r(v)).map((n) => n.toFixed(1)).join(",")).join(" ");
  return (
    <div className="opt-d">
      <svg viewBox={`0 0 ${S} ${S}`} className="opt-d-svg" role="img" aria-label="Average d20 per ability vs fair 10.5">
        {[LO + 3, LO + 6, HI].map((g) => (
          <polygon key={g} points={poly(Array(6).fill(g))} fill="none" stroke="var(--grid)" />
        ))}
        {abilities.map((_, i) => {
          const [x, y] = pt(i, R);
          return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="var(--grid)" />;
        })}
        <polygon points={poly(Array(6).fill(FAIR))} fill="none" stroke="var(--c5)" strokeDasharray="4 4" strokeWidth={1.5} />
        <motion.polygon
          points={poly(abilities.map((a) => (a.rolls >= THIN ? a.avgD20! : FAIR)))} //under 5 rolls -> sits on the fair ring, too few to judge
          fill="color-mix(in srgb, var(--accent) 30%, transparent)"
          stroke="var(--accent)"
          strokeWidth={2}
          initial={{ scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: EASE }}
          style={{ transformOrigin: `${C}px ${C}px` }}
        />
        {abilities.map((a, i) => {
          const [x, y] = pt(i, R + 22);
          return (
            <g key={a.code}>
              <text x={x} y={y - 4} textAnchor="middle" className="opt-d-code">{a.code}</text>
              <text x={x} y={y + 11} textAnchor="middle" className="opt-d-val">
                {a.rolls >= THIN ? a.avgD20!.toFixed(1) : `${a.rolls} roll${a.rolls === 1 ? "" : "s"}`}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><i style={{ background: "var(--accent)" }} />Avg d20</span>
        <span><i className="line" style={{ background: "var(--c5)" }} />Fair 10.5</span>
      </div>
    </div>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Helpers
//--------------------------------------------------------------------------------------------------------------

// ability score -> "+2 mod" text; 5e modifier = (score - 10) / 2 rounded down
//params: score (number | null)
//output: string
function modText(score: number | null): string {
  if (score === null) return "no score";
  const m = Math.floor((score - 10) / 2);
  return `${m >= 0 ? "+" : ""}${m}`;
}

// "+0.6 vs fair · 73 rolls"
//params: a (SheetAbility)
//output: string
function luckText(a: SheetAbility): string {
  if (!a.rolls) return "no rolls";
  const d = a.avgD20! - FAIR;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)} vs fair · ${a.rolls} rolls`;
}
