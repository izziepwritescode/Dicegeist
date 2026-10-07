-- Dicegeist reporting: rolls_fact + save-spell damage columns (damage per cast replaces the DC slider)
-- Usage Syntax: applied as migration 20261007144812_reporting_save_damage; must run after the other rolls_fact migrations

--------------------------------------------------------------------------------------------------------------
-- Outline
--   save_dmg CTE       damage rolls from save spells -> 'half' / 'none' damage on a successful save
--   rolls_fact         full definition, latest of every column added so far; 2 new at the end:
--     save_damage_kind  'half' = damage lands pass or fail; 'none' = damage only on a failed save
--     is_save_damage    damage rolls only: came from a save spell, so hit / miss cannot be inferred
--   also carries heal_multiplier / heal_hp (healing thread) and is_spell_cast as live on 2026-10-07
--------------------------------------------------------------------------------------------------------------
create or replace view reporting.rolls_fact as
 WITH dice AS (
         SELECT d.roll_id,
            count(*) AS dice_count,
            sum(d.face) FILTER (WHERE d.is_kept) AS kept_dice_sum,
            sum((d.sides + 1)::numeric / 2.0) FILTER (WHERE d.is_kept) AS kept_dice_expected
           FROM roll_dice d
          GROUP BY d.roll_id
        ), gaps AS (
         SELECT r.id, r.character_id, r.owner_id, r.game_session_id, r.import_id, r.roller_name, r.rolled_at,
            r.platform, r.formula, r.category, r.skill_code, r.ability_code, r.roll_mode, r.natural_d20,
            r.modifier, r.total, r.target_value, r.is_success, r.is_hidden, r.raw_text, r.dedupe_key,
            r.created_at, r.is_spell, r.spell_name, r.spell_level, r.damage_type,
                CASE
                    WHEN lag(r.rolled_at) OVER w IS NULL OR (r.rolled_at - lag(r.rolled_at) OVER w) > '06:00:00'::interval THEN 1
                    ELSE 0
                END AS is_new_session
           FROM rolls r
          WINDOW w AS (PARTITION BY r.character_id ORDER BY r.rolled_at, r.id)
        ), sess AS (
         SELECT g.id, g.character_id, g.owner_id, g.game_session_id, g.import_id, g.roller_name, g.rolled_at,
            g.platform, g.formula, g.category, g.skill_code, g.ability_code, g.roll_mode, g.natural_d20,
            g.modifier, g.total, g.target_value, g.is_success, g.is_hidden, g.raw_text, g.dedupe_key,
            g.created_at, g.is_spell, g.spell_name, g.spell_level, g.damage_type, g.is_new_session,
            sum(g.is_new_session) OVER (PARTITION BY g.character_id ORDER BY g.rolled_at, g.id ROWS UNBOUNDED PRECEDING) AS play_session_no
           FROM gaps g
        ), spell_attacks AS (
         SELECT DISTINCT r.character_id, r.spell_name
           FROM rolls r
          WHERE r.is_spell AND r.category = 'attack'::roll_category
        ), spell_base AS (
         SELECT v.spell_name, v.base_level
           FROM ( VALUES ('Eldritch Blast'::text,0), ('Fire Bolt'::text,0), ('Thorn Whip'::text,0), ('Shocking Grasp'::text,0), ('Chill Touch'::text,0), ('Chromatic Orb'::text,1), ('Guiding Bolt'::text,1), ('Witch Bolt'::text,1), ('Cure Wounds'::text,1), ('Healing Word'::text,1), ('Hunter''s Mark'::text,1), ('Thunderous Smite'::text,1), ('Divine Smite'::text,1), ('Scorching Ray'::text,2), ('Shatter'::text,2), ('Fireball'::text,3), ('Hunger of Hadar'::text,3), ('Blight'::text,4)) v(spell_name, base_level)
        ), dice_level AS (
         SELECT r.id AS roll_id,
                CASE r.spell_name
                    WHEN 'Cure Wounds'::text THEN f.n / 2
                    WHEN 'Healing Word'::text THEN f.n / 2
                    WHEN 'Shatter'::text THEN f.n - 1
                    WHEN 'Fireball'::text THEN f.n - 5
                    WHEN 'Blight'::text THEN f.n - 4
                    ELSE NULL::integer
                END AS dice_level
           FROM rolls r
             CROSS JOIN LATERAL ( SELECT "substring"(r.formula, '^\s*(\d+)d'::text)::integer AS n) f
          WHERE r.category = ANY (ARRAY['damage'::roll_category, 'healing'::roll_category])
        ), save_dmg AS (
         SELECT r.id AS roll_id,
            COALESCE("substring"(r.raw_text, '"damageOnSave": "(\w+)"'::text),  --foundry flags each save damage roll
                CASE
                    WHEN r.spell_name = ANY (ARRAY['Fireball'::text, 'Shatter'::text, 'Spirit Guardians'::text, 'Moonbeam'::text, 'Blight'::text, 'Arms of Hadar'::text, 'Glyph of Warding'::text, 'Laeral''s Silver Lance'::text]) THEN 'half'::text
                    WHEN r.spell_name = ANY (ARRAY['Sacred Flame'::text, 'Toll the Dead'::text]) THEN 'none'::text
                    ELSE NULL::text
                END) AS save_damage_kind   --roll20 + old foundry actors: lookup by spell
           FROM rolls r
          WHERE r.category = 'damage'::roll_category
        )
 SELECT s.id AS roll_id,
    s.character_id,
    c.name AS character_name,
    s.platform::text AS platform,
    s.play_session_no::integer AS play_session_no,
    min((s.rolled_at AT TIME ZONE 'America/New_York'::text)::date) OVER (PARTITION BY s.character_id, s.play_session_no) AS play_date,
    s.rolled_at,
    s.category::text AS category,
    initcap(replace(s.category::text, '_'::text, ' '::text)) AS category_label,
        CASE
            WHEN s.category = 'skill_check'::roll_category THEN sk.name
            WHEN s.category = ANY (ARRAY['ability_check'::roll_category, 'saving_throw'::roll_category]) THEN ab.name
            ELSE NULL::text
        END AS check_name,
    ab.name AS ability_name,
    s.roll_mode::text AS roll_mode,
    s.formula,
    s.natural_d20,
        CASE s.roll_mode
            WHEN 'advantage'::roll_mode THEN 13.825
            WHEN 'disadvantage'::roll_mode THEN 7.175
            ELSE 10.5
        END *
        CASE
            WHEN s.natural_d20 IS NULL THEN NULL::integer
            ELSE 1
        END::numeric AS expected_natural_d20,
    s.natural_d20 = 20 AS is_nat20,
    s.natural_d20 = 1 AS is_nat1,
    s.modifier,
    s.total,
    s.target_value,
    s.is_success,
    s.is_spell,
    s.spell_name,
    s.spell_level,
    s.damage_type,
        CASE
            WHEN s.category = 'damage'::roll_category THEN
            CASE
                WHEN s.is_spell THEN 'Spell'::text
                ELSE 'Weapon / other'::text
            END
            ELSE NULL::text
        END AS damage_source,
    COALESCE(s.spell_name,
        CASE
            WHEN s.category = 'attack'::roll_category THEN 'Weapon attack'::text
            ELSE NULL::text
        END) AS attack_source,
    dc.dice_count,
    dc.kept_dice_sum,
    dc.kept_dice_expected,
        CASE
            WHEN s.category = 'death_save'::roll_category THEN
            CASE
                WHEN s.natural_d20 = 20 THEN 'Nat 20 (back up)'::text
                WHEN s.natural_d20 = 1 THEN 'Nat 1 (two fails)'::text
                WHEN s.total >= 10 THEN 'Success'::text
                ELSE 'Fail'::text
            END
            ELSE NULL::text
        END AS death_save_result,
    s.platform <> 'roll20'::source_platform AS counts_for_death_saves,
    s.platform <> 'roll20'::source_platform AND NOT (s.category = 'healing'::roll_category AND (s.raw_text ~~* '%Potion of%'::text OR s.raw_text ~* '(Spellfire Burst|Twilight Sanctuary)'::text)) AS counts_for_healing,
    s.is_hidden,
    ab.code AS ability_code,
        CASE ab.code
            WHEN 'STR'::text THEN 1
            WHEN 'DEX'::text THEN 2
            WHEN 'CON'::text THEN 3
            WHEN 'INT'::text THEN 4
            WHEN 'WIS'::text THEN 5
            WHEN 'CHA'::text THEN 6
            ELSE NULL::integer
        END AS ability_order,
    COALESCE(s.spell_level::integer, dl.dice_level, sb.base_level) AS spell_level_filled,
        CASE
            WHEN s.spell_level IS NOT NULL THEN 'log'::text
            WHEN dl.dice_level IS NOT NULL THEN 'dice count'::text
            WHEN sb.base_level IS NOT NULL THEN 'base level lookup'::text
            ELSE NULL::text
        END AS spell_level_source,
    COALESCE(s.is_spell AND (s.category = 'attack'::roll_category OR sa.spell_name IS NULL) AND NOT (s.platform = 'foundry'::source_platform AND s.category = 'damage'::roll_category AND COALESCE("substring"(s.raw_text, '"flavor": "([^"]*)"'::text), ''::text) = ''::text), false) AS is_spell_cast,
    s.platform <> 'roll20'::source_platform AND s.category = 'healing'::roll_category AND s.raw_text ~* '(Spellfire Burst|Twilight Sanctuary)'::text AS is_temp_hp,
    ao.inferred_hit, --damage rolled after the attack (attack_outcomes); null = no evidence row
        CASE
            WHEN s.category <> 'attack'::roll_category THEN NULL::text
            WHEN s.target_value IS NOT NULL THEN 'logged AC'::text
            WHEN ao.roll_id IS NOT NULL THEN 'damage evidence'::text
            ELSE 'slider'::text
        END AS hit_basis,
        CASE
            WHEN s.category <> 'attack'::roll_category THEN NULL::boolean
            WHEN s.target_value IS NOT NULL THEN s.natural_d20 = 20 OR (s.natural_d20 IS DISTINCT FROM 1 AND s.total >= s.target_value)
            ELSE ao.inferred_hit
        END AS attack_hit, --null on an attack -> DAX falls back to the Assumed AC slider
        CASE
            WHEN s.category <> 'healing'::roll_category THEN NULL::integer
            WHEN s.spell_name = ANY (ARRAY['Mass Healing Word'::text, 'Mass Cure Wounds'::text, 'Prayer of Healing'::text]) THEN 4
            WHEN s.raw_text ~* 'Twilight Sanctuary'::text THEN 5
            ELSE 1
        END AS heal_multiplier,
        CASE
            WHEN s.category = 'healing'::roll_category THEN s.total *
            CASE
                WHEN s.spell_name = ANY (ARRAY['Mass Healing Word'::text, 'Mass Cure Wounds'::text, 'Prayer of Healing'::text]) THEN 4
                WHEN s.raw_text ~* 'Twilight Sanctuary'::text THEN 5
                ELSE 1
            END
            ELSE NULL::integer
        END AS heal_hp,
    sd.save_damage_kind,       --'half' = damage lands pass or fail; 'none' = only on a failed save
        CASE
            WHEN s.category = 'damage'::roll_category THEN sd.save_damage_kind IS NOT NULL
            ELSE NULL::boolean
        END AS is_save_damage  --true -> no hit / miss can be read from this roll
   FROM sess s
     JOIN characters c ON c.id = s.character_id
     LEFT JOIN skills_abilities sk ON sk.code = s.skill_code
     LEFT JOIN skills_abilities ab ON ab.code = COALESCE(s.ability_code, sk.ability_code,
        CASE
            WHEN s.category = 'initiative'::roll_category THEN 'DEX'::text
            ELSE NULL::text
        END)
     LEFT JOIN dice dc ON dc.roll_id = s.id
     LEFT JOIN spell_attacks sa ON sa.character_id = s.character_id AND sa.spell_name = s.spell_name
     LEFT JOIN spell_base sb ON sb.spell_name = s.spell_name
     LEFT JOIN dice_level dl ON dl.roll_id = s.id
     LEFT JOIN attack_outcomes ao ON ao.roll_id = s.id
     LEFT JOIN save_dmg sd ON sd.roll_id = s.id;
