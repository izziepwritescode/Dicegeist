// sample data for local dev / first deploy before Supabase env vars are set
// Usage Syntax: used automatically by lib/data.ts when NEXT_PUBLIC_SUPABASE_URL or _ANON_KEY is missing
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Seeded random
//     rng
//   Demo rows
//     CHARS (const)
//     demoCharacters
//     demoDetail
//--------------------------------------------------------------------------------------------------------------

import type { CharacterCard, CharacterDetail } from "./data"; //row shapes only

//--------------------------------------------------------------------------------------------------------------
//Seeded random (same numbers every load, so the demo does not jitter)
//--------------------------------------------------------------------------------------------------------------

// mulberry32 PRNG
//params: seed (number) - any integer
//output: () => number - returns 0..1
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0; //32-bit wraparound add
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

//--------------------------------------------------------------------------------------------------------------
//Demo rows
//--------------------------------------------------------------------------------------------------------------

const CHARS = [
  { id: 1, name: "Lazlo", campaign: "Sample Campaign A", className: "Warlock", rolls: 900, platform: "roll20" },
  { id: 2, name: "Vasha", campaign: "Sample Campaign B", className: "Paladin", rolls: 700, platform: "roll20" },
  { id: 3, name: "Idris Ildroun", campaign: "Sample Campaign C", className: "Cleric", rolls: 720, platform: "foundry" },
  { id: 4, name: "Ivan Maddock", campaign: "Sample Campaign D", className: "Sorcerer", rolls: 520, platform: "foundry" },
];

const SKILLS = ["perception", "insight", "stealth", "arcana", "athletics", "persuasion", "investigation", "deception"];

// d20 faces for one character, simulated
//params: id (number) - demo character id; n (number) - d20s to roll
//output: number[] - 20 counts, index 0 = face 1
function faces(id: number, n: number): number[] {
  const r = rng(id * 97);
  const counts = Array(20).fill(0);
  for (let i = 0; i < n; i++) counts[Math.floor(r() * 20)]++;
  return counts;
}

// list of demo cards
//output: CharacterCard[]
export function demoCharacters(): CharacterCard[] {
  return CHARS.map((c) => {
    const f = faces(c.id, Math.round(c.rolls * 0.6));
    const n = f.reduce((a, b) => a + b, 0);
    const avg = f.reduce((a, cnt, i) => a + cnt * (i + 1), 0) / n; //sumproduct(face, count) / count
    return {
      id: c.id,
      name: c.name,
      campaign: c.campaign,
      className: c.className,
      rollCount: c.rolls,
      d20Count: n,
      avgD20: Math.round(avg * 100) / 100,
      nat20s: f[19],
      nat1s: f[0],
      successRate: null,
      lastRollAt: new Date().toISOString(),
      platform: c.platform,
      bestSkill: { name: SKILL_NAMES[c.id % 8], avgD20: 12.4 + c.id * 0.3, rollCount: 14 },
      worstSkill: { name: SKILL_NAMES[(c.id + 3) % 8], avgD20: 8.9 - c.id * 0.2, rollCount: 11 },
      attacks: Math.round(c.rolls * 0.3),
      spellsCast: Math.round(c.rolls * (0.12 + c.id * 0.04)),
      totalDamage: Math.round(c.rolls * 2.6),
    };
  });
}

const SKILL_NAMES = ["Perception", "Insight", "Stealth", "Arcana", "Athletics", "Persuasion", "Investigation", "Deception"];

// one demo character's breakdown
//params: id (number) - demo character id
//output: CharacterDetail | null
export function demoDetail(id: number): CharacterDetail | null {
  const card = demoCharacters().find((c) => c.id === id);
  if (!card) return null;
  const f = faces(id, card.d20Count);
  const r = rng(id * 13);
  return {
    card,
    faces: f.map((times, i) => ({ face: i + 1, times, share: times / card.d20Count })),
    skills: SKILLS.map((code, i) => {
      const rollCount = 30 - i * 3;
      const avgD20 = Math.round((7.5 + r() * 6) * 100) / 100;
      return {
        code,
        name: code[0].toUpperCase() + code.slice(1),
        rollCount,
        avgD20,
        avgTotal: avgD20 + 4,
        nat20s: Math.round(r() * 3),
        nat1s: Math.round(r() * 3),
      };
    }),
  };
}
