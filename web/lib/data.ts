// data layer: typed reads from the Supabase views, demo fallback when env is unset
// Usage Syntax: import { fetchCharacters, fetchCharacterDetail } from "@/lib/data"
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Types
//     CharacterCard / SkillPick / SkillStat / FaceStat / CharacterDetail
//   Client
//     isDemo / getClient
//   Queries
//     fetchCharacters
//     fetchCharacterDetail
//   Helpers
//     num
//     pickSkills
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
  platform: string | null; //roll20 / foundry; from rolls.platform
  bestSkill: SkillPick | null; //highest avg d20, skills with >= MIN_SKILL_ROLLS only
  worstSkill: SkillPick | null;
};

export type SkillPick = { name: string; avgD20: number; rollCount: number };

const MIN_SKILL_ROLLS = 5; //fewer rolls -> average too noisy to call best/worst

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

  //four reads, joined here; same as LEFT JOINs from characters on character_id
  const [chars, sums, skills, lookup] = await Promise.all([
    sb.from("characters").select("id, name, campaign, class_name, is_npc"),
    sb.from("character_roll_summary").select("*"),
    sb.from("skill_roll_stats").select("character_id, skill_code, roll_count, avg_natural_d20"),
    sb.from("skills_abilities").select("code, name"),
  ]);
  for (const r of [chars, sums, skills, lookup]) if (r.error) throw r.error;
  const visible = chars.data!.filter((c) => !c.is_npc);

  //platform: one roll per character is enough (limit 1, like TOP 1)
  const plats = await Promise.all(
    visible.map((c) => sb.from("rolls").select("platform").eq("character_id", c.id).limit(1).maybeSingle()),
  );

  const byId = new Map(sums.data!.map((s) => [s.character_id as number, s])); //lookup like XLOOKUP on character_id
  const names = new Map(lookup.data!.map((s) => [s.code as string, s.name as string]));
  return visible
    .map((c, i) => ({
      ...toCard(c, byId.get(c.id)),
      platform: (plats[i].data?.platform as string) ?? null,
      ...pickSkills(skills.data!.filter((s) => s.character_id === c.id), names),
    }))
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
    platform: null,
    bestSkill: null,
    worstSkill: null,
  };
}

// best + worst skill by avg natural d20; unlabelled checks and thin samples skipped
//params: rows (skill_roll_stats rows for one character); names (Map code -> display name)
//output: { bestSkill, worstSkill } - SkillPick or null each
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickSkills(rows: any[], names: Map<string, string>): { bestSkill: SkillPick | null; worstSkill: SkillPick | null } {
  const ok = rows
    .filter((r) => r.skill_code && (num(r.roll_count) ?? 0) >= MIN_SKILL_ROLLS && num(r.avg_natural_d20) !== null)
    .map((r) => ({ name: names.get(r.skill_code) ?? r.skill_code, avgD20: num(r.avg_natural_d20)!, rollCount: num(r.roll_count)! }))
    .sort((a, b) => b.avgD20 - a.avgD20); //highest first
  if (ok.length === 0) return { bestSkill: null, worstSkill: null };
  return { bestSkill: ok[0], worstSkill: ok.length > 1 ? ok[ok.length - 1] : null };
}
