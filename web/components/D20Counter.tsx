// hero d20: translucent icosahedron silhouette with the total roll count ticking up inside
// Usage Syntax: <D20Counter value={totalRolls} />
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Geometry
//     HEX / FACE / FACETS (svg points, 200x200 box)
//   Component
//     D20Counter
//   Helpers
//     fontFor
//--------------------------------------------------------------------------------------------------------------

"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react"; //tweened number + spin-in
import { useEffect, useRef } from "react";

//--------------------------------------------------------------------------------------------------------------
//Geometry (pointy-top hexagon outline + centre face, the classic d20 drawing)
//--------------------------------------------------------------------------------------------------------------

const HEX = "100,4 183,52 183,148 100,196 17,148 17,52"; //outer silhouette, clockwise from top
const FACE = "100,48 152,138 48,138"; //front triangle, holds the number

//facet lines: each [x1, y1, x2, y2], joining the front triangle to the outline
const FACETS: [number, number, number, number][] = [
  [100, 4, 100, 48],
  [100, 48, 17, 52], [100, 48, 183, 52],
  [152, 138, 183, 52], [152, 138, 183, 148], [152, 138, 100, 196],
  [48, 138, 17, 52], [48, 138, 17, 148], [48, 138, 100, 196],
];

const COUNT_S = 1.2; //seconds to tick from old total to new

//--------------------------------------------------------------------------------------------------------------
//Component
//--------------------------------------------------------------------------------------------------------------

// spins in on load; number counts up to value; small tumble each time value grows from a live update
//params: value (number | null) - total rolls tracked; null while loading
//output: JSX.Element (svg)
export function D20Counter({ value }: { value: number | null }) {
  const count = useMotionValue(0);
  const fmt = new Intl.NumberFormat("en-US"); //2881 -> 2,881
  const text = useTransform(count, (v) => fmt.format(Math.round(v))); //motion value -> display string
  const spin = useMotionValue(0);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    if (value === null) return;
    const ctl = animate(count, value, { duration: COUNT_S, ease: [0.16, 1, 0.3, 1] }); //fast start, soft landing
    //live update after first load -> quick tumble, like the die being re-rolled
    if (prev.current !== null && value !== prev.current) {
      animate(spin, [0, 14, -10, 4, 0], { duration: 0.7, ease: "easeOut" });
    }
    prev.current = value;
    return () => ctl.stop();
  }, [value, count, spin]);

  const digits = fmt.format(value ?? 0).length;

  return (
    <motion.svg
      className="d20-counter"
      viewBox="0 0 200 200"
      role="img"
      aria-label={value === null ? "Loading total rolls" : `${fmt.format(value)} rolls tracked`}
      initial={{ opacity: 0, scale: 0.6, rotate: -120 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 90, damping: 14 }} //overshoots slightly then settles
      style={{ rotate: spin }}
    >
      <polygon points={HEX} className="d20-body" />
      <polygon points={FACE} className="d20-face" />
      {FACETS.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="d20-facet" />
      ))}
      <motion.text x="100" y="112" textAnchor="middle" className="d20-number" style={{ fontSize: fontFor(digits) }}>
        {text}
      </motion.text>
      <text x="100" y="128" textAnchor="middle" className="d20-label">
        rolls
      </text>
    </motion.svg>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Helpers
//--------------------------------------------------------------------------------------------------------------

// shrink the number as it gets longer so it stays inside the front triangle
//params: chars (number) - formatted length incl. commas
//output: number - font size in svg units
function fontFor(chars: number): number {
  if (chars <= 3) return 34;
  if (chars <= 5) return 25; //up to 99,999
  if (chars <= 7) return 21; //up to 999,999
  return 17;
}
