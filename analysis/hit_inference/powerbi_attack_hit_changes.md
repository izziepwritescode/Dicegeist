# power bi changes: attack hits from logged AC -> damage evidence -> slider
Live DB already has it (migrations `attack_outcomes`, `reporting_attack_hit`, 2026-10-07). These are the matching edits for `/mnt/project-files/powerbi/` (owned by the Power BI dashboards thread).

## rolls_fact new columns (appended)
| column | type | meaning |
|---|---|---|
| inferred_hit | bool | damage rolled after the attack (null = no evidence row) |
| hit_basis | text | attacks only: `logged AC` / `damage evidence` / `slider` |
| attack_hit | bool | attacks only: logged AC result, else inferred_hit; null -> slider |

## 03_power_query.m, RollsFact `Typed` step
add to the type list:
```
{"inferred_hit", type logical}, {"attack_hit", type logical}
```
(`hit_basis` is text, no change needed). Refresh -> the 3 columns appear.

## 04 / 05 / 06 measures: replace Attack Hits + Attack AC Note
```
//attack hit: logged AC (Foundry) -> damage rolled after it -> AC slider only when neither exists
//#format: whole number
Attack Hits =
VAR ac = [Assumed AC Value]
VAR known =
    CALCULATE ( COUNTROWS ( RollsFact ), RollsFact[category] = "attack", RollsFact[attack_hit] = TRUE () )
VAR bySlider =
    CALCULATE (
        COUNTROWS ( RollsFact ),
        RollsFact[category] = "attack",
        FILTER (
            RollsFact,
            ISBLANK ( RollsFact[attack_hit] )            //no logged AC, no damage evidence
                && ( RollsFact[natural_d20] = 20
                     || ( RollsFact[natural_d20] <> 1 && RollsFact[total] >= ac ) )
        )
    )
RETURN
    known + bySlider

//how each attack was judged; card subtitle
Attack AC Note =
VAR byAc  = CALCULATE ( [Rolls], RollsFact[hit_basis] = "logged AC" )
VAR byDmg = CALCULATE ( [Rolls], RollsFact[hit_basis] = "damage evidence" )
VAR bySl  = CALCULATE ( [Rolls], RollsFact[hit_basis] = "slider" )
RETURN
    FORMAT ( byAc + 0, "0" ) & " vs logged AC, " & FORMAT ( byDmg + 0, "0" ) & " from damage rolls, "
        & FORMAT ( bySl + 0, "0" ) & " vs AC " & FORMAT ( [Assumed AC Value], "0" )
```
Attack Misses / Hit Rate / Miss Rate unchanged (built on Attack Hits).

### Code breakdown
- `known` - counts attacks the DB already decided (`attack_hit` = TRUE). Like `COUNTIFS(category,"attack",attack_hit,TRUE)`.
- `bySlider` - only rows where `attack_hit` is blank get the old slider test. Today that is 0 rows for all four characters, so the slider no longer moves hit rate; it stays for future imports without evidence (Roll20 attack+damage template users).
- `known + bySlider` - two disjoint sets, so adding them never double counts.

## expected values (live, 2026-10-07)
| character | attacks | basis | hit % (was, AC 14) |
|---|---|---|---|
| Lazlo | 288 | damage 288 | 69.8 (77.1) |
| Vasha | 221 | damage 221 | 71.9 (79.6) |
| Ivan Maddock | 98 | logged AC 72, damage 26 | 76.5 (86.7) |
| Idris Ildroun | 50 | logged AC 19, damage 31 | 62.0 (66.0) |

## README line to replace (powerbi/README.md "Attack hit rate")
- Attack hit rate: logged AC where Foundry has a target (Ivan 72, Idris 19); else damage evidence (`attack_outcomes`, see analysis/hit_inference/README.md); `Assumed AC` slider only for attacks with neither (none today).
