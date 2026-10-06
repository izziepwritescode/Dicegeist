// Power Query (M) for the Dicegeist Power BI model: one connection + 5 queries off the reporting schema
// Usage Syntax: Power BI Desktop -> Transform data -> New Source -> Blank Query -> Advanced Editor -> paste ONE block per query,
//   rename the query to the name in its header line (e.g. "PgHost"), repeat for each block below

//--------------------------------------------------------------------------------------------------------------
// Outline
//   Parameters
//     PgHost        pooler host:port, from Supabase Connect dialog
//   Connection
//     Dicegeist     PostgreSQL.Database source; Enable load OFF (helper only)
//   Tables (loaded)
//     CharactersDim   reporting.characters_dim
//     RollsFact       reporting.rolls_fact
//     DiceFact        reporting.dice_fact
//     PlaySessions    reporting.play_sessions
//     DieFairness     reporting.die_fairness
//
// Credentials (asked once, on first refresh): Database tab
//   user      powerbi_reader.xrwydjehpwaaxeexneid
//   password  the one set in 02_powerbi_reader_role.sql
//--------------------------------------------------------------------------------------------------------------


//--------------------------------------------------------------------------------------------------------------
// Query: PgHost  (parameter)
// session pooler, port 5432; direct db.<ref>.supabase.co host is IPv6-only, most home networks can't reach it
//--------------------------------------------------------------------------------------------------------------
"aws-0-us-east-1.pooler.supabase.com:5432" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]


//--------------------------------------------------------------------------------------------------------------
// Query: Dicegeist  (right-click -> uncheck Enable load)
//--------------------------------------------------------------------------------------------------------------
let
    Source = PostgreSQL.Database(PgHost, "postgres", [CreateNavigationProperties = false]) //db name is always "postgres" on Supabase; no auto relationship columns
in
    Source


//--------------------------------------------------------------------------------------------------------------
// Query: CharactersDim
//--------------------------------------------------------------------------------------------------------------
let
    Source = Dicegeist,
    View   = Source{[Schema = "reporting", Item = "characters_dim"]}[Data], //navigate: pick row where Schema/Item match, take its Data table
    Typed  = Table.TransformColumnTypes(View, {
                 {"character_id", Int64.Type}, {"roll_count", Int64.Type}, {"play_sessions", Int64.Type},
                 {"first_roll_at", type datetimezone}, {"last_roll_at", type datetimezone}})
in
    Typed


//--------------------------------------------------------------------------------------------------------------
// Query: RollsFact
//--------------------------------------------------------------------------------------------------------------
let
    Source = Dicegeist,
    View   = Source{[Schema = "reporting", Item = "rolls_fact"]}[Data],
    Typed  = Table.TransformColumnTypes(View, {
                 {"roll_id", Int64.Type}, {"character_id", Int64.Type}, {"play_session_no", Int64.Type},
                 {"play_date", type date}, {"rolled_at", type datetimezone},
                 {"natural_d20", Int64.Type}, {"expected_natural_d20", type number},
                 {"modifier", Int64.Type}, {"total", Int64.Type}, {"target_value", Int64.Type},
                 {"spell_level", Int64.Type}, {"dice_count", Int64.Type},
                 {"kept_dice_sum", Int64.Type}, {"kept_dice_expected", type number},
                 {"is_nat20", type logical}, {"is_nat1", type logical}, {"is_success", type logical},
                 {"is_spell", type logical}, {"counts_for_death_saves", type logical},
                 {"counts_for_healing", type logical}, {"is_hidden", type logical}}),
    //sort key so roll_mode shows Disadvantage -> Normal -> Advantage on axes (Column tools -> Sort by column)
    ModeSort = Table.AddColumn(Typed, "roll_mode_sort",
                 each if [roll_mode] = "disadvantage" then 1 else if [roll_mode] = "advantage" then 3 else 2, Int64.Type)
in
    ModeSort


//--------------------------------------------------------------------------------------------------------------
// Query: DiceFact
//--------------------------------------------------------------------------------------------------------------
let
    Source = Dicegeist,
    View   = Source{[Schema = "reporting", Item = "dice_fact"]}[Data],
    Typed  = Table.TransformColumnTypes(View, {
                 {"die_id", Int64.Type}, {"roll_id", Int64.Type}, {"character_id", Int64.Type},
                 {"sides", Int64.Type}, {"face", Int64.Type}, {"is_kept", type logical}})
in
    Typed


//--------------------------------------------------------------------------------------------------------------
// Query: PlaySessions
//--------------------------------------------------------------------------------------------------------------
let
    Source = Dicegeist,
    View   = Source{[Schema = "reporting", Item = "play_sessions"]}[Data],
    Typed  = Table.TransformColumnTypes(View, {
                 {"character_id", Int64.Type}, {"play_session_no", Int64.Type}, {"play_date", type date},
                 {"started_at", type datetimezone}, {"ended_at", type datetimezone},
                 {"roll_count", Int64.Type}, {"d20_count", Int64.Type},
                 {"avg_natural_d20", type number}, {"expected_natural_d20", type number},
                 {"nat_20s", Int64.Type}, {"nat_1s", Int64.Type}, {"damage_rolled", Int64.Type}})
in
    Typed


//--------------------------------------------------------------------------------------------------------------
// Query: DieFairness
//--------------------------------------------------------------------------------------------------------------
let
    Source = Dicegeist,
    View   = Source{[Schema = "reporting", Item = "die_fairness"]}[Data],
    Typed  = Table.TransformColumnTypes(View, {
                 {"character_id", Int64.Type}, {"sides", Int64.Type}, {"dice_rolled", Int64.Type},
                 {"avg_face", type number}, {"expected_avg_face", type number},
                 {"degrees_of_freedom", Int64.Type}, {"chi_square", type number},
                 {"critical_value_05", type number}})
in
    Typed
