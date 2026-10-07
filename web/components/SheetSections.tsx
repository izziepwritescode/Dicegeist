// character page sections built from character_sheet(): headline tiles, abilities, attacks, damage, spells, play nights
// Usage Syntax: <SheetKpis sheet={detail.sheet} /> ... <NightsChart nights={detail.sheet.nights} />
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Shared
//     SplitBar
//     BarRow
//     Legend
//   Sections
//     SheetKpis
//     AbilitiesArray
//     AttackSplit
//     DamageByType
//     SpellVsWeapon
//     SpellsCast
//     NightsChart
//   Helpers
//     pct / fmt / levelLabel / levelColor
//--------------------------------------------------------------------------------------------------------------

"use client";

import { motion } from "motion/react"; //bar grow-in
import { useEffect, useRef, useState } from "react";
import type { CharacterSheet, SheetAbility, SheetNight, SheetSpell } from "@/lib/data";
import { StatTile } from "./ui";

const EASE = [0.22, 1, 0.36, 1] as const; //same ease-out as the rest of the site

//categorical colours from the character theme: accent first, then ramp steps (palette stays in-family)
const SERIES = ["var(--accent)", "var(--c5)", "var(--accent-deep)", "var(--c4)", "var(--c3)", "var(--ink-muted)"];

//--------------------------------------------------------------------------------------------------------------
//Shared
//--------------------------------------------------------------------------------------------------------------

// one stacked bar, segments sized by value; label shown inside when the segment is wide enough
//params: parts ({ value, color, label?, ink? }[]) - ink = text colour inside the segment
//output: JSX.Element
function SplitBar({ parts }: { parts: { value: number; color: string; label?: string; ink?: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="split" role="img" aria-label={parts.map((p) => p.label).filter(Boolean).join(", ")}>
      {parts.map((p, i) => (
        <motion.i
          key={i}
          initial={{ width: 0 }}
          whileInView={{ width: `${(p.value / total) * 100}%` }} //grow when scrolled into view
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: EASE, delay: i * 0.05 }}
          style={{ background: p.color, color: p.ink ?? "#ffffff" }}
        >
          {p.value / total > 0.1 ? p.label : ""} {/* hide text on slivers */}
        </motion.i>
      ))}
    </div>
  );
}

// label | bar | number row; second colour = remainder of the track (hit vs miss)
//params: label (ReactNode); value / max (number); color (string); right (ReactNode); rest (string) - remainder colour
//output: JSX.Element
function BarRow({ label, value, max, color, right, rest }: {
  label: React.ReactNode; value: number; max: number; color: string; right: React.ReactNode; rest?: string;
}) {
  const w = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track" style={rest ? { background: rest } : undefined}>
        <motion.i
          initial={{ width: 0 }}
          whileInView={{ width: `${w}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: EASE }}
          style={{ background: color }}
        />
      </div>
      <span className="bar-num">{right}</span>
    </div>
  );
}

// colour key under a chart
//params: items ([label, color][])
//output: JSX.Element
function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="legend">
      {items.map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}
    </div>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Sections
//--------------------------------------------------------------------------------------------------------------

// headline tiles: rolls, nat 20 / 1, attacks, damage, spells, healing, avg d20
//params: sheet (CharacterSheet)
//output: JSX.Element
export function SheetKpis({ sheet }: { sheet: CharacterSheet }) {
  const k = sheet.kpis;
  return (
    <div className="stats-row stats-row-8">
      <StatTile label="Total rolls" value={k.rolls} sub={`${fmt(k.d20s)} with a d20`} />
      <StatTile label="Nat 20s" value={k.nat20s} sub={`${pct(k.nat20s, k.d20s)} of d20s (fair 5%)`} />
      <StatTile label="Nat 1s" value={k.nat1s} sub={`${pct(k.nat1s, k.d20s)} of d20s (fair 5%)`} />
      <StatTile label="Attacks" value={k.attacks} sub={`${pct(k.hits, k.attacks, 0)} hit`} />
      <StatTile label="Total damage" value={k.damage} sub={`${pct(k.spellDamage, k.damage, 0)} from spells`} />
      <StatTile label="Spells cast" value={k.spellsCast} />
      <StatTile
        label="Healing (HP)"
        value={k.healHP} //null on roll20 -> dash
        sub={k.healHP === null ? "Roll20 excluded" : `${k.heals} heals${k.tempHP ? ` · +${fmt(k.tempHP)} temp HP` : ""}`}
      />
      <StatTile label="Avg d20" value={k.avgD20} decimals={2} sub={k.expectedD20 === null ? undefined : `expected ${k.expectedD20.toFixed(2)}`} />
    </div>
  );
}

// six ability blocks: score + mod, then avg / highest total and d20 from checks, skills, initiative
//params: abilities (SheetAbility[]) - STR..CHA order
//output: JSX.Element
export function AbilitiesArray({ abilities }: { abilities: SheetAbility[] }) {
  const rolls = abilities.reduce((a, x) => a + x.rolls, 0);
  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2>Abilities array</h2>
          <p>Ability score, then the average and highest of {fmt(rolls)} ability checks, skills and initiative (initiative counts as DEX).</p>
        </div>
      </div>
      <div className="abil-grid">
        {abilities.map((a) => {
          const mod = a.score === null ? null : Math.floor((a.score - 10) / 2); //5e modifier: (score - 10) / 2 rounded down
          return (
            <div key={a.code} className="abil">
              <div className="abil-code">{a.code}</div>
              <div className="abil-score">{a.score ?? "–"}</div>
              <div className="abil-note">
                {mod === null ? "score not entered" : `${mod >= 0 ? "+" : ""}${mod} mod`} · {a.rolls} rolls
              </div>
              {a.rolls ? (
                <>
                  <div className="abil-stats">
                    <div><b>{a.avgTotal?.toFixed(1)}</b><span>avg total</span></div>
                    <div><b>{a.maxTotal}</b><span>highest</span></div>
                  </div>
                  <div className="abil-note">d20 avg {a.avgD20?.toFixed(1)} · high {a.maxD20}</div>
                </>
              ) : (
                <div className="abil-note">no rolls</div>
              )}
            </div>
          );
        })}
      </div>
      <p className="card-foot">
        Totals include modifiers. The d20 figures are the natural roll, using the kept die on advantage and disadvantage. Saving throws are left out.
      </p>
    </div>
  );
}

// hit vs miss overall, then per attack source (spell or weapon)
//params: attacks (CharacterSheet["attacks"]); total / hits (number)
//output: JSX.Element
export function AttackSplit({ attacks, total, hits }: { attacks: CharacterSheet["attacks"]; total: number; hits: number }) {
  const b = attacks.basis;
  //how each hit was decided, only the parts that apply
  const basis = [
    b.loggedAC && `${b.loggedAC} vs the AC Foundry logged`,
    b.damageEvidence && `${b.damageEvidence} from damage rolled after the attack`,
    b.slider && `${b.slider} vs the assumed AC`,
  ].filter(Boolean).join(", ");
  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2>Attacks: hit vs miss</h2>
          <p>{total} attack rolls{basis && ` · ${basis}`}</p>
        </div>
      </div>
      {total ? (
        <>
          <SplitBar
            parts={[
              { value: hits, color: "var(--good)", label: `${hits} hit · ${pct(hits, total, 0)}`, ink: "var(--on-accent)" },
              { value: total - hits, color: "var(--critical)", label: `${total - hits} miss` },
            ]}
          />
          {attacks.sources.map((s) => (
            <BarRow
              key={s.source}
              label={s.source}
              value={s.hits}
              max={s.attacks}
              color="var(--good)"
              rest="color-mix(in srgb, var(--critical) 70%, transparent)" //unfilled track = misses
              right={`${s.hits}/${s.attacks} · ${pct(s.hits, s.attacks, 0)}`}
            />
          ))}
        </>
      ) : (
        <p className="card-empty">No attack rolls yet.</p>
      )}
    </div>
  );
}

// damage per type, coloured by rank; spell / weapon tag after each type
//params: types (CharacterSheet["damageTypes"]) - sorted by damage desc
//output: JSX.Element
export function DamageByType({ types }: { types: CharacterSheet["damageTypes"] }) {
  const total = types.reduce((a, t) => a + t.damage, 0);
  const rolls = types.reduce((a, t) => a + t.rolls, 0);
  const color = (i: number) => SERIES[Math.min(i, SERIES.length - 1)]; //rank -> palette step; tail shares the last
  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2>Damage by type</h2>
          <p>{fmt(total)} damage across {fmt(rolls)} damage rolls</p>
        </div>
      </div>
      {total ? (
        <>
          <SplitBar parts={types.map((t, i) => ({ value: t.damage, color: color(i), label: pct(t.damage, total, 0), ink: i === 0 || i === 2 ? "var(--on-accent)" : "var(--c1)" }))} />
          {types.map((t, i) => (
            <BarRow
              key={`${t.type}-${t.source}`}
              label={<>{t.type} <small>{t.source}</small></>}
              value={t.damage}
              max={types[0].damage}
              color={color(i)}
              right={`${fmt(t.damage)} · ${pct(t.damage, total, 0)}`}
            />
          ))}
        </>
      ) : (
        <p className="card-empty">No damage rolls yet.</p>
      )}
    </div>
  );
}

// spell vs weapon share of damage, then average damage per roll
//params: total / spell (number) - damage; damage (CharacterSheet["damage"])
//output: JSX.Element
export function SpellVsWeapon({ total, spell, damage }: { total: number; spell: number; damage: CharacterSheet["damage"] }) {
  const weapon = total - spell;
  const avgs: [string, number | null, string][] = [
    ["Spell", damage.spellAvg, "var(--accent)"],
    ["Weapon", damage.weaponAvg, "var(--c5)"],
    ["All damage", damage.avg, "var(--ink-muted)"],
  ];
  const max = Math.max(...avgs.map(([, v]) => v ?? 0));
  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2>Spell vs weapon damage</h2>
          <p>Spell attacks and Divine Smite count as spell damage</p>
        </div>
      </div>
      <SplitBar
        parts={[
          { value: spell, color: "var(--accent)", label: `Spell ${pct(spell, total, 0)}`, ink: "var(--on-accent)" },
          { value: weapon, color: "var(--c5)", label: `Weapon ${pct(weapon, total, 0)}`, ink: "var(--c1)" },
        ]}
      />
      <Legend items={[[`Spell ${fmt(spell)}`, "var(--accent)"], [`Weapon / other ${fmt(weapon)}`, "var(--c5)"]]} />

      <h3 className="sub-head">Average damage per roll</h3>
      <p className="card-note">
        Biggest single roll: {damage.biggest ?? "–"}. Dice luck {damage.diceLuck?.toFixed(3) ?? "–"} (1.000 = dice rolled exactly average)
      </p>
      {avgs.filter(([, v]) => v !== null).map(([l, v, c]) => (
        <BarRow key={l} label={l} value={v!} max={max} color={c} right={v!.toFixed(1)} />
      ))}
    </div>
  );
}

// casts by spell level, then a per-spell table
//params: levels (CharacterSheet["spellLevels"]); spells (SheetSpell[]); total (number) - all casts
//output: JSX.Element
export function SpellsCast({ levels, spells, total }: { levels: CharacterSheet["spellLevels"]; spells: SheetSpell[]; total: number }) {
  const known = levels.filter((l) => l.level !== null); //unknown level left off the bar, still in the total
  const n = known.reduce((a, l) => a + l.casts, 0);
  const top = Math.max(1, ...known.map((l) => l.level!));
  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2>Spells cast</h2>
          <p>{fmt(total)} casts. Each spell attack roll counts as a cast (every beam or ray); other spells count once per damage or healing roll</p>
        </div>
      </div>
      {total ? (
        <>
          <SplitBar
            parts={known.map((l) => ({
              value: l.casts,
              color: levelColor(l.level!, top),
              label: `${l.level ? `L${l.level}` : "Cantrip"} ${pct(l.casts, n, 0)}`,
              ink: "var(--c1)",
            }))}
          />
          <Legend items={known.map((l) => [`${l.level ? `Level ${l.level}` : "Cantrip"}: ${l.casts} (${pct(l.casts, n)})`, levelColor(l.level!, top)])} />
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr><th>Spell</th><th>Level</th><th>Casts</th><th>Damage</th><th>Healing</th></tr>
              </thead>
              <tbody>
                {spells.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td>{levelLabel(s.minLevel, s.maxLevel)}</td>
                    <td>{s.casts}</td>
                    <td>{s.damage ? fmt(s.damage) : "–"}</td>
                    <td>{s.healing ? fmt(s.healing) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="card-empty">No spells cast yet.</p>
      )}
    </div>
  );
}

const NH = 220; //px chart height; width measured
const NPAD = { top: 10, right: 8, bottom: 24, left: 32 };

// average natural d20 per play night (accent line) vs expected after advantage / disadvantage (dashed)
//params: nights (SheetNight[]) - in date order
//output: JSX.Element
export function NightsChart({ nights }: { nights: SheetNight[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(520);
  const [hover, setHover] = useState<number | null>(null);

  //track container width -> 1 svg unit = 1 css px, text stays 11px
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const pts = nights.filter((n) => n.d20s > 0 && n.avgD20 !== null); //nights with no d20 have no average
  const qual = pts.filter((n) => n.d20s >= 5); //best / worst need 5+ d20s, fewer is noise
  const best = qual.reduce<SheetNight | null>((p, n) => (!p || n.avgD20! > p.avgD20! ? n : p), null);
  const worst = qual.reduce<SheetNight | null>((p, n) => (!p || n.avgD20! < p.avgD20! ? n : p), null);

  const plotW = W - NPAD.left - NPAD.right;
  const plotH = NH - NPAD.top - NPAD.bottom;
  const x = (i: number) => NPAD.left + (pts.length > 1 ? (i / (pts.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => NPAD.top + plotH * (1 - (v - 1) / 19); //1..20 scale
  const line = (get: (n: SheetNight) => number | null) =>
    pts.map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(get(n) ?? 10.5).toFixed(1)}`).join(""); //svg path "M x,y L x,y ..."
  const h = hover === null ? null : pts[hover];

  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2>Luck by play night</h2>
          <p>Average natural d20 per night vs expected after advantage and disadvantage (dashed)</p>
        </div>
      </div>
      {pts.length ? (
        <>
          <div ref={wrap} className="chart-wrap">
            <svg className="chart" width={W} height={NH} role="img" aria-label="Average d20 per play night" onMouseLeave={() => setHover(null)}>
              {[1, 5.5, 10.5, 15.5, 20].map((t) => (
                <g key={t}>
                  <line x1={NPAD.left} x2={W - NPAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
                  <text x={NPAD.left - 6} y={y(t) + 4} textAnchor="end">{t}</text>
                </g>
              ))}
              <path d={line((n) => n.expectedD20)} fill="none" stroke="var(--c5)" strokeWidth={1.2} strokeDasharray="4 4" />
              <motion.path
                d={line((n) => n.avgD20)}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                initial={{ pathLength: 0 }}
                whileInView={{ pathLength: 1 }} //draw left -> right
                viewport={{ once: true }}
                transition={{ duration: 1.2, ease: EASE }}
              />
              {pts.map((n, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(n.avgD20!)}
                  r={Math.max(2, Math.min(5, Math.sqrt(n.d20s)))} //dot size ~ d20s that night
                  fill="var(--accent)"
                  onMouseEnter={() => setHover(i)}
                />
              ))}
              <text x={NPAD.left} y={NH - 6}>{pts[0].date}</text>
              <text x={W - NPAD.right} y={NH - 6} textAnchor="end">{pts[pts.length - 1].date}</text>
            </svg>
            {h && (
              <div
                className="tooltip"
                style={{ left: Math.min(Math.max(x(hover!), 110), W - 110), top: y(h.avgD20!) }} //clamped so it never spills off the card
              >
                <strong>{h.date}</strong><span>avg {h.avgD20} over {h.d20s} d20s · expected {h.expectedD20}</span>
              </div>
            )}
          </div>
          <div className="nights">
            {best && (
              <div className="night">
                <div className="night-k">Best night (5+ d20s)</div>
                <div className="night-d" style={{ color: "var(--good)" }}>{best.date}</div>
                <div className="night-k">avg {best.avgD20} over {best.d20s} d20s · {best.nat20s} nat 20s</div>
              </div>
            )}
            {worst && (
              <div className="night">
                <div className="night-k">Worst night (5+ d20s)</div>
                <div className="night-d" style={{ color: "var(--critical)" }}>{worst.date}</div>
                <div className="night-k">avg {worst.avgD20} over {worst.d20s} d20s · {worst.nat1s} nat 1s</div>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="card-empty">No d20 rolls on any night yet.</p>
      )}
    </div>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Helpers
//--------------------------------------------------------------------------------------------------------------

// a / b as a percent string; "–" when b is 0
//params: a, b (number); d (number) - decimals
//output: string
function pct(a: number, b: number, d = 1): string {
  return b ? `${((100 * a) / b).toFixed(d)}%` : "–";
}

// thousands separators, like Excel's #,##0
//params: n (number)
//output: string
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// spell level range as text: 0 -> Cantrip, 1..4 -> "1–4", unknown -> "?"
//params: lo, hi (number | null)
//output: string
function levelLabel(lo: number | null, hi: number | null): string {
  if (lo === null || hi === null) return "?";
  if (hi === 0) return "Cantrip";
  return lo === hi ? String(lo) : `${lo}–${hi}`; //upcast spells show their range
}

// level -> accent strength: cantrips lightest, top level full accent
//params: level (number); top (number) - highest level cast
//output: string - css colour
function levelColor(level: number, top: number): string {
  const strength = 35 + Math.round((65 * level) / top); //35%..100% accent over the light ramp step
  return `color-mix(in srgb, var(--accent) ${strength}%, var(--c5))`;
}
