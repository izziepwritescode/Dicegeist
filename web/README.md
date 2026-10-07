# Dicegeist web

Public site for Dicegeist: one page per public character, live from Supabase. Next.js (React) app, hosted on Vercel.

## Usage

```bash
cd web
cp .env.example .env.local   # fill in the anon / publishable key
npm install
npm run dev                  # http://localhost:3000
```

No `.env.local` -> site runs on built-in demo data (banner at top says so).

## Deploy (Vercel)

Vercel -> Add New -> Project -> import `izziepwritescode/dicegeist`:

| Setting | Value |
|---|---|
| Framework Preset | Next.js |
| Root Directory | `web` |
| Build / Output | defaults |
| Env `NEXT_PUBLIC_SUPABASE_URL` | `https://xrwydjehpwaaxeexneid.supabase.co` |
| Env `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase -> Project Settings -> API Keys -> publishable key (`sb_publishable_...`) or legacy anon key |

Every push to `main` redeploys. Data changes need no redeploy.

Never put the `service_role` / secret key in this app: anything `NEXT_PUBLIC_` ships to every visitor's browser.

## Database prerequisites

- Character visible on the site only when `characters.is_public = true` (row-level security hides the rest):
  ```sql
  update public.characters set is_public = true where id in (1, 2, 3, 4);
  ```
- Live push updates: run `supabase/migrations/20261007180000_realtime_rolls.sql` once. Without it -> no change events, page only updates on reload.
- Attacks / spells cast / total damage on the home panel: run `supabase/migrations/20261007200000_character_combat_summary.sql` once. Without it -> those stats show a dash.

## Layout

```
web/
  app/
    layout.tsx              root shell: fonts, footer, demo banner
    template.tsx            page transition (fade + rise on every navigation)
    page.tsx                "/" character cards + totals
    character/[id]/page.tsx "/character/1" detail: tiles, d20 face chart, skill chart
    globals.css             colour tokens (dark default, light via OS), shared styles
  components/
    ui.tsx                  LiveBadge, CountUp, StatTile, LuckMeter, D20Icon
    FaceChart.tsx           d20 face distribution vs fair 5%
    SkillChart.tsx          per-skill avg d20, diverging around 10.5
    MotionRoot.tsx          respects OS reduce-motion
  lib/
    data.ts                 Supabase client + queries -> typed rows
    useLive.ts              fetch + realtime refresh hook
    demo.ts                 seeded fake data for no-env runs
```

## Code breakdown

### Data flow

Browser -> Supabase REST API (read-only key) -> views from `001_dnd_stats_schema.sql`:

| UI piece | View / table | SQL equivalent |
|---|---|---|
| character cards | `characters` + `character_roll_summary` | `LEFT JOIN` on `character_id`, done in JS |
| d20 faces | `die_cursedness_checks` | `WHERE character_id = :id AND sides = 20` |
| skill chart | `skill_roll_stats` + `skills_abilities` | code -> display name lookup |

Supabase query builder reads like SQL:

```ts
sb.from("die_cursedness_checks")          // FROM die_cursedness_checks
  .select("face, times_rolled")           // SELECT face, times_rolled
  .eq("character_id", id)                 // WHERE character_id = id
  .eq("sides", 20);                       //   AND sides = 20
```

Numbers from `numeric` / `bigint` columns arrive as text over the API -> `num()` in `lib/data.ts` converts (same as `Number.From` in M).

### Live updates (`lib/useLive.ts`)

1. first load: run the query, store rows
2. open a Realtime channel on `rolls` + `characters`; any insert/update/delete -> refetch
3. debounce 1.5s: bulk import of 900 rolls = 900 events -> one refetch once they stop
4. connection drops (sleep, wifi) -> badge reads "Reconnecting", supabase-js retries; on reconnect -> one catch-up refetch
5. no timers: no database change -> no query

Equivalent to Power BI "refresh on change", never a scheduled refresh. `pulse` counter ticks on each refresh -> totals flash.

### Transitions

`motion` library (`motion/react`):
- `template.tsx`: every route fades + rises in
- `variants` + `staggerChildren`: cards / sections enter one after another (80ms apart)
- `whileHover={{ y: -4 }}`: card lift
- chart bars: `scaleY` / `scaleX` 0 -> 1, delayed per bar -> ripple
- `CountUp`: tweens text from old value to new, no re-render per frame
- OS "reduce motion" on -> `MotionRoot` + CSS media query skip the movement

### Charts

Hand-built SVG/CSS, no chart library:
- `FaceChart`: measures its container (`ResizeObserver`) so 1 SVG unit = 1px -> text stays 11px at any width. Per-bar hover/focus tooltip; "Show table" toggle for an accessible table view.
- `SkillChart`: bar starts at 10.5, grows right (blue, luckier) or left (red, unluckier). Under 5 rolls -> faded, average mostly noise.
- `LuckMeter`: track zoomed to 8.5..12.5; real averages sit within ~1 of 10.5, a 1..20 track would hide the gap.
