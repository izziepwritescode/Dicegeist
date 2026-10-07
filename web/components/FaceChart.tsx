// d20 face distribution: share of rolls per face vs the 5% a fair die gives each face
// Usage Syntax: <FaceChart faces={detail.faces} />
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Constants
//     H / PAD (svg geometry)
//   Chart
//     FaceChart
//   Helpers
//     barPath
//--------------------------------------------------------------------------------------------------------------

"use client";

import { motion } from "motion/react"; //bar grow-in animation
import { useEffect, useRef, useState } from "react";
import type { FaceStat } from "@/lib/data";

//--------------------------------------------------------------------------------------------------------------
//Constants
//--------------------------------------------------------------------------------------------------------------

const H = 260; //px; width follows the container so text never scales up
const PAD = { top: 16, right: 8, bottom: 26, left: 36 };
const FAIR = 1 / 20; //expected share per face

//--------------------------------------------------------------------------------------------------------------
//Chart
//--------------------------------------------------------------------------------------------------------------

// bar per face; nat 1 / nat 20 bars use status colors, dashed line = fair share
//params: faces (FaceStat[]) - 20 rows, face 1..20
//output: JSX.Element
export function FaceChart({ faces }: { faces: FaceStat[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640); //measured container width in px

  //track container width -> 1 svg unit = 1 css px
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [table]);

  const total = faces.reduce((a, f) => a + f.times, 0);

  //y scale: 0 .. a bit above the tallest bar or the fair line, rounded up to the next 1%
  const yMax = Math.ceil(Math.max(FAIR * 1.4, ...faces.map((f) => f.share)) * 100) / 100;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / 20;
  const barW = Math.max(2, slot - 4); //2px surface gap each side
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH; //share -> svg y
  const ticks = Array.from({ length: Math.round(yMax * 100 / 2) + 1 }, (_, i) => i * 0.02).filter((t) => t <= yMax + 1e-9);

  const color = (face: number) => (face === 20 ? "var(--good)" : face === 1 ? "var(--critical)" : "var(--accent)");
  const h = hover === null ? null : faces[hover];

  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2>d20 faces</h2>
          <p>{total.toLocaleString()} d20s, including dropped advantage dice. Fair die: 5% each.</p>
        </div>
        <button className="toggle" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>

      {table ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Face</th><th>Times</th><th>Share</th><th>vs fair</th></tr>
            </thead>
            <tbody>
              {faces.map((f) => (
                <tr key={f.face}>
                  <td>{f.face}</td>
                  <td>{f.times}</td>
                  <td>{(f.share * 100).toFixed(1)}%</td>
                  <td>{((f.share - FAIR) * 100 >= 0 ? "+" : "") + ((f.share - FAIR) * 100).toFixed(1)} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" ref={wrap} onMouseLeave={() => setHover(null)}>
          <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Share of d20 rolls per face">
            {/* gridlines + y labels */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{Math.round(t * 100)}%</text>
              </g>
            ))}

            {/* bars */}
            {faces.map((f, i) => {
              const x = PAD.left + i * slot + 2;
              return (
                <g key={f.face}>
                  <motion.path
                    d={barPath(x, y(f.share), barW, y(0))}
                    fill={color(f.face)}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.7, delay: i * 0.025, ease: [0.22, 1, 0.36, 1] }} //ripple left -> right
                    style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
                  />
                  {/* hit area: full slot height, bigger than the bar */}
                  <rect
                    x={PAD.left + i * slot}
                    y={PAD.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`Face ${f.face}: ${f.times} rolls, ${(f.share * 100).toFixed(1)}%`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  />
                  <text x={x + barW / 2} y={H - 8} textAnchor="middle" className={f.face === 1 || f.face === 20 ? "label-strong" : ""}>
                    {f.face}
                  </text>
                </g>
              );
            })}

            {/* fair reference line, drawn over bars */}
            <line x1={PAD.left} x2={W - PAD.right} y1={y(FAIR)} y2={y(FAIR)} stroke="var(--ink-2)" strokeDasharray="4 4" strokeWidth={1.5} pointerEvents="none" />
          </svg>

          {h && hover !== null && (
            <div
              className="tooltip"
              style={{
                left: `${((PAD.left + hover * slot + slot / 2) / W) * 100}%`,
                top: `${(y(h.share) / H) * 100}%`,
                //edge faces: anchor tooltip to the bar's side so it stays inside the card
                transform: `translate(${hover < 3 ? "-12px" : hover > 16 ? "calc(-100% + 12px)" : "-50%"}, calc(-100% - 10px))`,
              }}
            >
              <strong>{(h.share * 100).toFixed(1)}%</strong>
              <span>face {h.face} · {h.times} rolls · {((h.share - FAIR) * 100 >= 0 ? "+" : "") + ((h.share - FAIR) * 100).toFixed(1)} pts vs fair</span>
            </div>
          )}

          <div className="legend">
            <span><i style={{ background: "var(--accent)" }} />Face share</span>
            <span><i style={{ background: "var(--critical)" }} />Natural 1</span>
            <span><i style={{ background: "var(--good)" }} />Natural 20</span>
            <span><i className="line" style={{ borderTop: "2px dashed var(--ink-2)", background: "none" }} />Fair (5%)</span>
          </div>
        </div>
      )}
    </div>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Helpers
//--------------------------------------------------------------------------------------------------------------

// bar with 4px rounded top, square base on the axis
//params: x, top, w, base (number) - svg coords
//output: string - svg path d
function barPath(x: number, top: number, w: number, base: number): string {
  const r = Math.min(4, w / 2, Math.max(0, base - top)); //never round more than the bar is tall
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}
