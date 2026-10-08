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
//     demoSheet
//--------------------------------------------------------------------------------------------------------------

import type { CharacterCard, CharacterDetail, CharacterSheet } from "./data"; //row shapes only

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
  { id: 1, name: "Lazlo Remény-Benedek", campaign: "Sample Campaign A", className: "Warlock", subclass: "Hexblade", level: 12, rolls: 900, platform: "roll20" },
  { id: 2, name: "Vasha Klenova", campaign: "Sample Campaign B", className: "Paladin", subclass: "Vengeance", level: 10, rolls: 700, platform: "roll20" },
  { id: 3, name: "Idris Ildroun", campaign: "Sample Campaign C", className: "Cleric", subclass: "Twilight", level: 9, rolls: 720, platform: "foundry" },
  { id: 4, name: "Ivan Maddock", campaign: "Sample Campaign D", className: "Sorcerer", subclass: "Spellfire", level: 6, rolls: 520, platform: "foundry" },
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
      subclass: c.subclass,
      level: c.level,
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
    sheet: demoSheet(card),
  };
}

// stat sheet in the character_sheet() shape; fixed spread of attacks / spells, play nights simulated
//params: card (CharacterCard) - totals reused so the sheet agrees with the tiles
//output: CharacterSheet
function demoSheet(card: CharacterCard): CharacterSheet {
  const r = rng(card.id * 31);
  const roll20 = card.platform === "roll20";
  const nights = Array.from({ length: 40 }, (_, i) => {
    const d20s = Math.round(r() * 20);
    const date = new Date(Date.UTC(2025, 0, 7 + i * 7)).toISOString().slice(0, 10); //weekly
    return {
      date,
      d20s,
      avgD20: d20s ? Math.round((6 + r() * 9) * 100) / 100 : null,
      expectedD20: d20s ? Math.round((10 + r() * 1.5) * 1000) / 1000 : null,
      nat20s: Math.round(r() * 2),
      nat1s: Math.round(r() * 2),
    };
  });
  return {
    kpis: {
      rolls: card.rollCount, d20s: card.d20Count, nat20s: card.nat20s, nat1s: card.nat1s,
      avgD20: card.avgD20, expectedD20: 10.89,
      attacks: card.attacks ?? 0, hits: Math.round((card.attacks ?? 0) * 0.62),
      damage: card.totalDamage ?? 0, spellDamage: Math.round((card.totalDamage ?? 0) * 0.8), spellsCast: card.spellsCast ?? 0,
      healHP: roll20 ? null : 1553, heals: roll20 ? null : 87, tempHP: roll20 ? null : 685,
      nights: nights.length, platform: card.platform,
    },
    abilities: [
      ["STR", 8, 18, 8.9, 8.6, 20, 20], ["DEX", 14, 73, 11.1, 13.2, 23, 20], ["CON", 16, 1, 1, 4, 4, 1],
      ["INT", 10, 36, 10.9, 13, 23, 20], ["WIS", 20, 80, 9.6, 16.6, 31, 20], ["CHA", 14, 12, 11.7, 15.3, 24, 19],
    ].map(([code, score, rolls, avgD20, avgTotal, maxTotal, maxD20]) => ({
      code: code as string, score: score as number, rolls: rolls as number, avgD20: avgD20 as number,
      avgTotal: avgTotal as number, maxTotal: maxTotal as number, maxD20: maxD20 as number,
    })),
    attacks: {
      basis: roll20 ? { loggedAC: 0, damageEvidence: 50, slider: 0 } : { loggedAC: 19, damageEvidence: 31, slider: 0 },
      streaks: { hit: { length: 9, from: "2025-03-04", to: "2025-03-18" }, miss: { length: 4, from: "2025-06-10", to: "2025-06-10" } },
      sources: [
        { source: "Spiritual Weapon", attacks: 31, hits: 19 },
        { source: "Guiding Bolt", attacks: 10, hits: 8 },
        { source: "Weapon attack", attacks: 9, hits: 4 },
      ],
    },
    damageTypes: [
      { type: "Radiant", source: "Spell", rolls: 100, damage: 1277 },
      { type: "Force", source: "Spell", rolls: 27, damage: 249 },
      { type: "Necrotic", source: "Spell", rolls: 6, damage: 76 },
      { type: "Untyped", source: "Weapon", rolls: 7, damage: 66 },
      { type: "Untyped", source: "Spell", rolls: 2, damage: 49 },
      { type: "Fire", source: "Spell", rolls: 1, damage: 27 },
    ],
    damage: { rolls: 143, avg: 12.2, spellAvg: 12.3, weaponAvg: 9.4, biggest: 31, diceLuck: 1.051 },
    spellLevels: [
      { level: 0, casts: 53 }, { level: 1, casts: 47 }, { level: 2, casts: 63 }, { level: 3, casts: 37 }, { level: 4, casts: 6 },
    ],
    spells: [
      { name: "Cure Wounds", minLevel: 1, maxLevel: 4, casts: 61, damage: 0, healing: 1103 },
      { name: "Sacred Flame", minLevel: 0, maxLevel: 0, casts: 48, damage: 492, healing: 0 },
      { name: "Spiritual Weapon", minLevel: 2, maxLevel: 2, casts: 31, damage: 249, healing: 0 },
      { name: "Healing Word", minLevel: 1, maxLevel: 4, casts: 19, damage: 0, healing: 226 },
      { name: "Spirit Guardians", minLevel: 3, maxLevel: 3, casts: 18, damage: 527, healing: 0 },
      { name: "Guiding Bolt", minLevel: 1, maxLevel: 4, casts: 10, damage: 169, healing: 0 },
    ],
    nights,
  };
}
