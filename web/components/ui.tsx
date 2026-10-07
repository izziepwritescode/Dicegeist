// small shared UI pieces: logo glyph, live badge, animated number, stat tile, luck meter
// Usage Syntax: import { LiveBadge, CountUp, StatTile, LuckMeter, D20Icon } from "@/components/ui"
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Glyphs
//     D20Icon
//   Status
//     LiveBadge
//   Numbers
//     CountUp
//     StatTile
//   Gauges
//     LuckMeter
//     FAIR_D20 (const)
//--------------------------------------------------------------------------------------------------------------

"use client";

import { animate, motion, useInView } from "motion/react"; //tweening + in-view trigger
import { useEffect, useRef, useState } from "react";
import type { LiveStatus } from "@/lib/useLive"; //status union from the live hook

export const FAIR_D20 = 10.5; //expected average of a fair d20: (1 + 20) / 2

//--------------------------------------------------------------------------------------------------------------
//Glyphs
//--------------------------------------------------------------------------------------------------------------

// icosahedron outline used as the logo
//params: size (number) - px width/height
//output: JSX.Element (svg)
export function D20Icon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
      <path d="M12 2 21 7v10l-9 5-9-5V7z" />
      <path d="M12 2 7.5 9.5h9zM7.5 9.5 3 7M16.5 9.5 21 7M7.5 9.5 12 17l4.5-7.5M12 17v5M12 17l-9 0M12 17l9 0" />
    </svg>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Status
//--------------------------------------------------------------------------------------------------------------

const STATUS_TEXT: Record<LiveStatus, string> = {
  loading: "Connecting",
  live: "Live",
  polling: "Auto-refresh",
  demo: "Demo data",
  error: "Offline",
};

// pill showing whether the page is receiving live updates
//params: status (LiveStatus) - from useLive
//output: JSX.Element
export function LiveBadge({ status }: { status: LiveStatus }) {
  return (
    <span className="pill" role="status" aria-live="polite">
      <span className={`live-dot ${status === "live" ? "on" : ""}`} aria-hidden />
      {STATUS_TEXT[status]}
    </span>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Numbers
//--------------------------------------------------------------------------------------------------------------

// number that counts up from its previous value when it scrolls into view / changes
//params: value (number) - target; decimals (number) - fixed decimals; suffix (string) - e.g. "%"
//output: JSX.Element (span)
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const from = useRef(0);
  const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); //1234 -> 1,234

  useEffect(() => {
    if (!inView || !ref.current) return;
    const el = ref.current;
    //tween text directly, no React re-render per frame
    const ctl = animate(from.current, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => (el.textContent = fmt.format(v) + suffix),
    });
    from.current = value;
    return () => ctl.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inView, decimals, suffix]);

  return <span ref={ref}>{fmt.format(0) + suffix}</span>;
}

// labelled big number
//params: label (string); value (number | null); decimals (number); sub (ReactNode) - small line under value; tone - optional colored dot
//output: JSX.Element
export function StatTile({
  label,
  value,
  decimals = 0,
  suffix = "",
  sub,
  tone,
}: {
  label: string;
  value: number | null;
  decimals?: number;
  suffix?: string;
  sub?: React.ReactNode;
  tone?: "good" | "critical";
}) {
  return (
    <div className="card">
      <div className="eyebrow">
        {tone && (
          <span
            aria-hidden
            style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, background: `var(--${tone})` }}
          />
        )}
        {label}
      </div>
      <div className="stat-value">{value === null ? "–" : <CountUp value={value} decimals={decimals} suffix={suffix} />}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

//--------------------------------------------------------------------------------------------------------------
//Gauges
//--------------------------------------------------------------------------------------------------------------

// horizontal track 8.5..12.5 with a tick at fair 10.5 and a marker sliding to the character's average
// range is zoomed in: real averages sit within ~1 of 10.5, a 1..20 track would hide the difference
//params: avg (number | null) - average natural d20
//output: JSX.Element
export function LuckMeter({ avg }: { avg: number | null }) {
  const MIN = 8.5;
  const MAX = 12.5;
  const pct = (v: number) => ((Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN)) * 100; //clamp then scale to 0..100
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const at = avg === null ? 50 : pct(avg);
  const fair = pct(FAIR_D20);
  const above = avg !== null && avg >= FAIR_D20;

  return (
    <div aria-label={avg === null ? "no d20 rolls" : `average d20 ${avg} vs fair 10.5`} role="img">
      <div style={{ position: "relative", height: 6, borderRadius: 999, background: "var(--surface-2)", margin: "14px 0 6px" }}>
        {/* fill from fair line to the average: blue = luckier, red = unluckier */}
        {avg !== null && (
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: ready ? 1 : 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${Math.min(at, fair)}%`,
              width: `${Math.abs(at - fair)}%`,
              background: above ? "var(--above)" : "var(--below)",
              borderRadius: 999,
              transformOrigin: above ? "left" : "right",
            }}
          />
        )}
        <div style={{ position: "absolute", left: `${fair}%`, top: -4, bottom: -4, width: 1, background: "var(--ink-muted)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-muted)" }}>
        <span>{MIN}</span>
        <span>fair 10.5</span>
        <span>{MAX}</span>
      </div>
    </div>
  );
}
