// home page v2: d20 roll counter + title header, tall character panels grouped by platform, hover info panel
// Usage Syntax: served at "/"
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Constants
//     PLATFORM_LABEL / PLATFORM_ORDER
//   Page
//     Home
//   Pieces
//     PanelGroup
//     Panel
//     InfoPanel
//     NetTotals
//     CharacterInfo
//   Helpers
//     groupByPlatform / firstName
//--------------------------------------------------------------------------------------------------------------

"use client";

import Link from "next/link"; //client-side navigation
import { useRouter } from "next/navigation"; //navigate on second tap (phones)
import { AnimatePresence, motion } from "motion/react"; //panel entrance + info crossfade
import { useRef, useState } from "react";
import { fetchCharacters, type CharacterCard } from "@/lib/data"; //Supabase reads
import { useLive } from "@/lib/useLive"; //refresh on new rolls
import { CountUp, FAIR_D20, LiveBadge, LuckMeter } from "@/components/ui";
import { D20Counter } from "@/components/D20Counter"; //hero die with total roll count
import { paletteFor, themeVars } from "@/lib/themes"; //per-character colour ramps + accents

//--------------------------------------------------------------------------------------------------------------
//Constants
//--------------------------------------------------------------------------------------------------------------

const PLATFORM_LABEL: Record<string, string> = { roll20: "Roll20", foundry: "Foundry VTT" };
const PLATFORM_ORDER = ["roll20", "foundry"]; //bracket order left -> right; unknown platforms go last
const EASE = [0.22, 1, 0.36, 1] as const; //same curve as --ease in globals.css

//--------------------------------------------------------------------------------------------------------------
//Page
//--------------------------------------------------------------------------------------------------------------

// header + panels + info panel; active = hovered (desktop) or tapped (phone) character id
//output: JSX.Element
export default function Home() {
  const { data, status, error, pulse } = useLive(fetchCharacters, []);
  const [active, setActive] = useState<number | null>(null);
  const total = data ? data.reduce((a, r) => a + r.rollCount, 0) : null;
  const activeChar = data?.find((c) => c.id === active) ?? null;

  return (
    <>
      {/* header: die left, title + rule + description right */}
      <section className="home-head home-band">
        <div className="home-die">
          <D20Counter value={total} />
          <span className="home-die-caption">&amp; counting</span>
        </div>
        <div>
          <div className="home-eyebrow">
            <span className="eyebrow">D&amp;D roll analytics</span>
            <LiveBadge status={status} />
          </div>
          <h1 className="home-title">Dicegeist</h1>
          <motion.hr
            className="home-rule"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.2 }}
          />
          <p className="home-desc">
            Every die rolled across my online campaigns, bulk-imported from Roll20 and Foundry and crunched per
            character and per skill. A fair d20 averages 10.5. Anything else is the dice gods playing favourites.
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
        <section className="home-body">
          {/* panels: mouse leaving the whole strip returns the info panel to net totals */}
          <div className="panel-strip" onMouseLeave={() => setActive(null)}>
            {groupByPlatform(data).map(([platform, chars], gi) => (
              <PanelGroup key={platform} platform={platform} chars={chars} groupIndex={gi} active={active} setActive={setActive} />
            ))}
          </div>
          <InfoPanel rows={data} active={activeChar} pulse={pulse} />
        </section>
      )}
    </>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Pieces
//--------------------------------------------------------------------------------------------------------------

// one platform's panels with a bracket + label underneath
//params: platform (string); chars (CharacterCard[]); groupIndex (number) - entrance delay; active / setActive - hover state
//output: JSX.Element
function PanelGroup({
  platform,
  chars,
  groupIndex,
  active,
  setActive,
}: {
  platform: string;
  chars: CharacterCard[];
  groupIndex: number;
  active: number | null;
  setActive: (id: number | null) => void;
}) {
  return (
    <div className="panel-group" style={{ flexGrow: chars.length }}>
      <div className="panel-row">
        {chars.map((c, i) => (
          <Panel key={c.id} c={c} delay={(groupIndex * 2 + i) * 0.08} isActive={active === c.id} setActive={setActive} />
        ))}
      </div>
      <motion.div
        className="panel-bracket"
        initial={{ opacity: 0, scaleX: 0.6 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.4 + groupIndex * 0.1 }}
      >
        <span>{PLATFORM_LABEL[platform] ?? platform}</span>
      </motion.div>
    </div>
  );
}

// tall card, first name written top -> bottom; widens slightly while active
//params: c (CharacterCard); delay (number) - entrance stagger; isActive (boolean); setActive - hover state setter
//output: JSX.Element
function Panel({
  c,
  delay,
  isActive,
  setActive,
}: {
  c: CharacterCard;
  delay: number;
  isActive: boolean;
  setActive: (id: number | null) => void;
}) {
  const router = useRouter();
  const touch = useRef(false); //true when the current press came from a finger, not a mouse

  //touch: first tap selects (shows info), second tap opens the page; mouse clicks navigate as normal
  const onClick = (e: React.MouseEvent) => {
    if (!touch.current) return;
    e.preventDefault();
    if (isActive) router.push(`/character/${c.id}`);
    else setActive(c.id);
  };

  return (
    <motion.div
      className="panel-wrap"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0, flexGrow: isActive ? 1.3 : 1 }} //flexGrow 1 -> 1.3 = slight widen
      transition={{ duration: 0.5, ease: EASE, delay: isActive ? 0 : delay, flexGrow: { duration: 0.35, ease: EASE } }}
    >
      <Link
        href={`/character/${c.id}`}
        className={`panel ${isActive ? "is-active" : ""}`}
        style={themeVars(c.name)} //character ramp + accent as local CSS vars
        onPointerDown={(e) => (touch.current = e.pointerType === "touch")}
        onMouseEnter={() => !touch.current && setActive(c.id)}
        onFocus={() => !touch.current && setActive(c.id)} //keyboard focus only; a tap also focuses, handled in onClick
        onClick={onClick}
        aria-label={`${c.name}, ${c.className ?? "character"}, average d20 ${c.avgD20 ?? "n/a"}`}
      >
        <span className="panel-name">{firstName(c.name)}</span>
        <span className="panel-foot">{c.avgD20?.toFixed(2) ?? "–"}</span>
      </Link>
    </motion.div>
  );
}

// right-hand box: net totals by default, crossfades to the active character
//params: rows (CharacterCard[]); active (CharacterCard | null); pulse (number) - live refresh counter
//output: JSX.Element
function InfoPanel({ rows, active, pulse }: { rows: CharacterCard[]; active: CharacterCard | null; pulse: number }) {
  //hovered character -> box takes their darkest ramp step + accent metrics; otherwise main palette
  const p = paletteFor(active?.name);
  const style = p ? { ...themeVars(active!.name), backgroundColor: p.ramp[0], color: "#ffffff" } : undefined;
  return (
    <aside className="card info-panel" aria-live="polite" style={style}>
      {pulse > 0 && <span key={pulse} className="flash-ring flash" aria-hidden />}
      <AnimatePresence mode="wait">
        <motion.div
          key={active?.id ?? "totals"} //new key -> old content fades out, new fades in
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          {active ? <CharacterInfo c={active} /> : <NetTotals rows={rows} />}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}

// default info: totals across every visible character
//params: rows (CharacterCard[])
//output: JSX.Element
function NetTotals({ rows }: { rows: CharacterCard[] }) {
  const d20s = rows.reduce((a, r) => a + r.d20Count, 0);
  //weighted average: sum(avg * d20 count) / total d20s, like SUMPRODUCT / SUM
  const avg = d20s ? rows.reduce((a, r) => a + (r.avgD20 ?? 0) * r.d20Count, 0) / d20s : null;
  const stats: [string, number, number][] = [
    ["d20s rolled", d20s, 0],
    ["Average d20", avg ?? 0, 2],
    ["Natural 20s", rows.reduce((a, r) => a + r.nat20s, 0), 0],
    ["Natural 1s", rows.reduce((a, r) => a + r.nat1s, 0), 0],
  ];
  return (
    <>
      <div className="eyebrow">All characters</div>
      <h2 className="info-title">Net totals</h2>
      <div className="info-grid">
        {stats.map(([label, v, dp]) => (
          <div key={label}>
            <div className="info-value"><CountUp value={v} decimals={dp} /></div>
            <div className="info-label">{label}</div>
          </div>
        ))}
      </div>
      <p className="info-hint">Hover a character to see their luck.</p>
    </>
  );
}

// active character: class/campaign, avg d20 + luck meter, counts, best/worst skill
//params: c (CharacterCard)
//output: JSX.Element
function CharacterInfo({ c }: { c: CharacterCard }) {
  const delta = c.avgD20 === null ? null : c.avgD20 - FAIR_D20;
  return (
    <>
      <div className="eyebrow">{[c.className, c.campaign].filter(Boolean).join(" · ") || "Adventurer"}</div>
      <h2 className="info-title">{c.name}</h2>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span className="info-value info-value-lg">{c.avgD20?.toFixed(2) ?? "–"}</span>
        <span className="info-label">
          avg d20{delta !== null && ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} vs fair`}
        </span>
      </div>
      <LuckMeter avg={c.avgD20} />
      <div className="info-grid info-grid-3">
        <div><div className="info-value">{c.rollCount.toLocaleString()}</div><div className="info-label">Rolls</div></div>
        <div><div className="info-value">{c.nat20s}</div><div className="info-label">Nat 20s</div></div>
        <div><div className="info-value">{c.nat1s}</div><div className="info-label">Nat 1s</div></div>
      </div>
      {(c.bestSkill || c.worstSkill) && (
        <dl className="info-skills">
          {c.bestSkill && (
            <div><dt>Luckiest skill</dt><dd>{c.bestSkill.name} <span>{c.bestSkill.avgD20.toFixed(2)}</span></dd></div>
          )}
          {c.worstSkill && (
            <div><dt>Unluckiest skill</dt><dd>{c.worstSkill.name} <span>{c.worstSkill.avgD20.toFixed(2)}</span></dd></div>
          )}
        </dl>
      )}
      <Link href={`/character/${c.id}`} className="info-hint info-link">Open full breakdown →</Link>
    </>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Helpers
//--------------------------------------------------------------------------------------------------------------

// characters -> [platform, chars][] in PLATFORM_ORDER, most rolls first inside each group
//params: rows (CharacterCard[])
//output: [string, CharacterCard[]][]
function groupByPlatform(rows: CharacterCard[]): [string, CharacterCard[]][] {
  const groups = new Map<string, CharacterCard[]>();
  for (const r of rows) {
    const k = r.platform ?? "other";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rank = (p: string) => (PLATFORM_ORDER.indexOf(p) + 1 || 99); //unknown -> end
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([p, cs]) => [p, cs.sort((a, b) => b.rollCount - a.rollCount)]);
}

// "Idris Ildroun" -> "Idris"; panels show first names only
//params: name (string)
//output: string
function firstName(name: string): string {
  return name.split(/\s+/)[0]; //split on whitespace, keep first word
}

