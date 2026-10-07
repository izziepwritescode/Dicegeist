// data layer: typed reads from the Supabase views, demo fallback when env is unset
// Usage Syntax: import { fetchCharacters, fetchCharacterDetail } from "@/lib/data"
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Types
//     CharacterCard / SkillStat / FaceStat / CharacterDetail
//   Client
//     isDemo / getClient
//   Queries
//     fetchCharacters
//     fetchCharacterDetail
//   Helpers
//     num
//--------------------------------------------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js"; //browser client for Supabase REST + realtime
import { demoCharacters, demoDetail } from "./demo"; //fake rows for when env vars are missing

//--------------------------------------------------------------------------------------------------------------
//Types (one per view row shape the UI uses)
//--------------------------------------------------------------------------------------------------------------

export type CharacterCard = {
  id: number;
  name: string;
  campaign: string | null;
  className: string | null;
  rollCount: number;
  d20Count: number;
  avgD20: number | null; //fair die = 10.5
  nat20s: number;
  nat1s: number;
  successRate: number | null; //known-DC rolls only
  lastRollAt: string | null;
};

export type SkillStat = {
  code: string | null;
  name: string;
  rollCount: number;
  avgD20: number | null;
  avgTotal: number | null;
  nat20s: number;
  nat1s: number;
};

export type FaceStat = { face: number; times: number; share: number };

export type CharacterDetail = {
  card: CharacterCard;
  skills: SkillStat[];
  faces: FaceStat[]; //d20 only, faces 1..20, missing faces filled with 0
};

//--------------------------------------------------------------------------------------------------------------
//Client
//--------------------------------------------------------------------------------------------------------------

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL; //inlined at build time by Next
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// true when env vars are missing -> site renders sample data instead of failing
//output: boolean
export const isDemo = !URL || !KEY;

let client: SupabaseClient | null = null;

// one shared client per browser tab; lazy so build/prerender never needs the keys
//output: SupabaseClient
export function getClient(): SupabaseClient {
  if (!client) client = createClient(URL!, KEY!, { auth: { persistSession: false } }); //read-only visitor, no login
  return client;
}

//--------------------------------------------------------------------------------------------------------------
//Queries
//--------------------------------------------------------------------------------------------------------------

// every character the visitor may read (RLS: is_public = true), with headline stats, most rolls first
//output: Promise<CharacterCard[]>
export async function fetchCharacters(): Promise<CharacterCard[]> {
  if (isDemo) return demoCharacters();
  const sb = getClient();

  //two reads, joined here; same as a LEFT JOIN characters -> character_roll_summary
  const [chars, sums] = await Promise.all([
    sb.from("characters").select("id, name, campaign, class_name, is_npc"),
    sb.from("character_roll_summary").select("*"),
  ]);
  if (chars.error) throw chars.error;
  if (sums.error) throw sums.error;

  const byId = new Map(sums.data.map((s) => [s.character_id as number, s])); //lookup like XLOOKUP on character_id
  return chars.data
    .filter((c) => !c.is_npc)
    .map((c) => toCard(c, byId.get(c.id)))
    .sort((a, b) => b.rollCount - a.rollCount);
}

// one character's full breakdown; null when missing or not public
//params: id (number) - characters.id
//output: Promise<CharacterDetail | null>
export async function fetchCharacterDetail(id: number): Promise<CharacterDetail | null> {
  if (isDemo) return demoDetail(id);
  const sb = getClient();

  //all five reads in parallel; RLS filters each to public characters
  const [char, sum, skills, faces, lookup] = await Promise.all([
    sb.from("characters").select("id, name, campaign, class_name").eq("id", id).maybeSingle(),
    sb.from("character_roll_summary").select("*").eq("character_id", id).maybeSingle(),
    sb.from("skill_roll_stats").select("*").eq("character_id", id),
    sb.from("die_cursedness_checks").select("face, times_rolled, observed_share").eq("character_id", id).eq("sides", 20),
    sb.from("skills_abilities").select("code, name"),
  ]);
  for (const r of [char, sum, skills, faces, lookup]) if (r.error) throw r.error;
  if (!char.data) return null;

  const names = new Map((lookup.data ?? []).map((s) => [s.code as string, s.name as string]));

  //fill all 20 faces so a never-rolled face shows as an empty bar, not a gap
  const faceRows = new Map((faces.data ?? []).map((f) => [f.face as number, f]));
  const faceStats: FaceStat[] = Array.from({ length: 20 }, (_, i) => {
    const f = faceRows.get(i + 1);
    return { face: i + 1, times: num(f?.times_rolled) ?? 0, share: num(f?.observed_share) ?? 0 };
  });

  return {
    card: toCard(char.data, sum.data ?? undefined),
    skills: (skills.data ?? [])
      .map((s) => ({
        code: s.skill_code,
        name: s.skill_code ? names.get(s.skill_code) ?? s.skill_code : "Unlabelled check", //null skill_code -> parser could not tag it
        rollCount: num(s.roll_count) ?? 0,
        avgD20: num(s.avg_natural_d20),
        avgTotal: num(s.avg_total),
        nat20s: num(s.nat_20s) ?? 0,
        nat1s: num(s.nat_1s) ?? 0,
      }))
      .sort((a, b) => b.rollCount - a.rollCount),
    faces: faceStats,
  };
}

//--------------------------------------------------------------------------------------------------------------
//Helpers
//--------------------------------------------------------------------------------------------------------------

// Postgres numeric/bigint arrive as strings over REST -> number; null stays null
//params: v (unknown) - raw column value
//output: number | null
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// character row + optional summary row -> CharacterCard
//params: c (characters row); s (character_roll_summary row | undefined)
//output: CharacterCard
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCard(c: any, s?: any): CharacterCard {
  return {
    id: c.id,
    name: c.name,
    campaign: c.campaign ?? null,
    className: c.class_name ?? null,
    rollCount: num(s?.roll_count) ?? 0,
    d20Count: num(s?.d20_count) ?? 0,
    avgD20: num(s?.avg_natural_d20),
    nat20s: num(s?.nat_20s) ?? 0,
    nat1s: num(s?.nat_1s) ?? 0,
    successRate: num(s?.success_rate),
    lastRollAt: s?.last_roll_at ?? null,
  };
}
