// d20 face distribution: share of rolls per face vs the 5% a fair die gives each face, one horizontal bar per face
// Usage Syntax: <FaceChart faces={detail.faces} />
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Constants
//     ROW / PAD / H (svg geometry)
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

const ROW = 17; //px per face row; width follows the container so text never scales up
const PAD = { top: 22, right: 12, bottom: 6, left: 28 }; //top = % axis labels
const H = PAD.top + ROW * 20 + PAD.bottom;
const FAIR = 1 / 20; //expected share per face

//--------------------------------------------------------------------------------------------------------------
//Chart
//--------------------------------------------------------------------------------------------------------------

// bar per face (face 1 at the top); nat 1 / nat 20 bars use status colors, dashed line = fair share
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

  //x scale: 0 .. a bit past the longest bar or the fair line, rounded up to the next 1%
  const xMax = Math.ceil(Math.max(FAIR * 1.4, ...faces.map((f) => f.share)) * 100) / 100;
  const plotW = W - PAD.left - PAD.right;
  const plotH = ROW * 20;
  const barH = ROW - 5; //surface gap between rows
  const x = (v: number) => PAD.left + (v / xMax) * plotW; //share -> svg x
  const rowY = (i: number) => PAD.top + i * ROW; //face index -> top of its row
  const ticks = Array.from({ length: Math.round(xMax * 100 / 2) + 1 }, (_, i) => i * 0.02).filter((t) => t <= xMax + 1e-9);

  const color = (face: number) => (face === 20 ? "var(--good)" : face === 1 ? "var(--critical)" : "var(--bar)"); //nat 20 punched out in the theme accent
  const h = hover === null ? null : faces[hover];

  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h2>d20 distribution</h2>
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
            {/* gridlines + % labels along the top */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={PAD.top} y2={PAD.top + plotH} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
                <text x={x(t)} y={PAD.top - 8} textAnchor="middle">{Math.round(t * 100)}%</text>
              </g>
            ))}

            {/* bars */}
            {faces.map((f, i) => (
              <g key={f.face}>
                <motion.path
                  d={barPath(x(0), rowY(i) + 2.5, Math.max(0, x(f.share) - x(0)), barH)}
                  fill={color(f.face)}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.7, delay: i * 0.025, ease: [0.22, 1, 0.36, 1] }} //ripple top -> bottom
                  style={{ transformBox: "fill-box", transformOrigin: "left" }}
                />
                {/* hit area: full row width, bigger than the bar */}
                <rect
                  x={0}
                  y={rowY(i)}
                  width={W}
                  height={ROW}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`Face ${f.face}: ${f.times} rolls, ${(f.share * 100).toFixed(1)}%`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
                <text x={PAD.left - 8} y={rowY(i) + ROW / 2} dy="0.32em" textAnchor="end" className={f.face === 1 || f.face === 20 ? "label-strong" : ""}>
                  {f.face}
                </text>
              </g>
            ))}

            {/* fair reference line, drawn over bars */}
            <line x1={x(FAIR)} x2={x(FAIR)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--ink-2)" strokeDasharray="4 4" strokeWidth={1.5} pointerEvents="none" />
          </svg>

          {h && hover !== null && (
            <div
              className="tooltip"
              style={{
                left: `${(Math.min(x(h.share), W - 60) / W) * 100}%`, //bar end, kept off the right edge
                top: `${(rowY(hover) / H) * 100}%`,
                transform: "translate(-50%, calc(-100% - 6px))",
              }}
            >
              <strong>{(h.share * 100).toFixed(1)}%</strong>
              <span>face {h.face} · {h.times} rolls · {((h.share - FAIR) * 100 >= 0 ? "+" : "") + ((h.share - FAIR) * 100).toFixed(1)} pts vs fair</span>
            </div>
          )}

          <div className="legend">
            <span><i style={{ background: "var(--bar)" }} />Face share</span>
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

// horizontal bar, square base on the axis, 4px rounded right end
//params: x, y (number) - top-left in svg coords; w, h (number) - length, thickness
//output: string - svg path d
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h / 2, w); //never round more than the bar is long
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}
