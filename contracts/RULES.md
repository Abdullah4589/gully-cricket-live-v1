# Scoring rules

Normative rules for the Gully Cricket Live engine. Score, scorecard, and live state are pure functions of match setup, innings starts, and the non-voided ball log. Replay that log from the start after every accepted ball and after every undo. Never treat a stored total as the source of truth.

`contracts/schemas/match-state.schema.json` is the derived state. `contracts/schemas/ball-event.schema.json` is one ball. A body that fails those schemas is rejected before these rules run.

## Setup

A match has two teams. Each team has a stable string `id`, a `name`, and an ordered player list. Every player has a stable string `id` and a `name`. A team has at least two players. Player ids are unique across the match. Team ids are distinct.

`overs` is the scheduled overs for each innings. It is a positive integer. `1` is a legal match. It is not a tie-break and it does not schedule another over if the scores finish level.

`rules` resolves missing keys to:

```json
{ "wide_runs": 1, "no_ball_runs": 1, "last_man_stands": true }
```

`wide_runs` and `no_ball_runs` are positive integers. The derived state always contains the resolved object.

Toss is `toss_winner_team_id` plus `toss_decision` of `bat` or `bowl`. Innings 1 bats if the winner chose `bat`; otherwise the other team bats. Innings 2 is the swap. The target is innings 1's total runs plus 1. It is null on innings 1 and on the match until innings 2 exists.

## Innings start

An innings start is not a ball. It is recorded before any ball of that innings:

`innings_number` `1` or `2`, `batting_team_id`, `bowling_team_id`, `striker_id`, `non_striker_id`, `opening_bowler_id`.

The two batters are distinct players on the batting side. The bowler is on the bowling side. `non_striker_id` is required at the start (a side cannot open with one batter). The teams must be the toss-derived sides. Anything else is `innings_lineup`.

Innings 2 can start only when the match status is `innings_break`. Starting it earlier is `innings_not_ready`. Starting innings 1 twice, or starting innings 2 twice, is `innings_not_ready`.

The first ball of the innings must use that striker, non-striker, and opening bowler. Later bowler and batter changes are whatever ids the next ball carries. The engine checks them. It does not choose the next player, and it does not use the squad order as a batting order.

After a legal start, and before any ball:

- status is `innings_1` or `innings_2`
- that innings is `0/0`, `complete: false`, extras all zero, fall of wickets empty, timeline empty, bowling card empty
- the two openers are on the batting card in striker, then non-striker, order, both `not out` with zero runs and zero balls
- `striker_id`, `non_striker_id`, and `bowler_id` are the start values
- `needs_new_batter` is null and `needs_new_bowler` is false
- innings 2's `target` is innings 1 runs + 1
- rates follow the innings 2 rule below, including a chase that has not faced a ball yet

## Ball event

Required fields:

| Field | Rule |
| --- | --- |
| `client_uuid` | UUID. Unique for the life of the match, including voided rows. |
| `seq` | Positive integer. Unique per match. Apply in ascending order. |
| `innings_number` | `1` or `2`. |
| `striker_id` | Batter on strike at the start of this delivery. |
| `non_striker_id` | The other batter, or null only when one not-out batter is alone. |
| `bowler_id` | Bowler of this delivery. |
| `runs_bat` | Integer `0` through `6`. The whole batter credit for the delivery. There is no separate overthrow field. |
| `extra_type` | null, `wide`, `no_ball`, `bye`, or `leg_bye`. |
| `extra_runs` | Integer `>= 0`. Running, byes, or overthrows that are not `runs_bat`. The penalty from `rules` is not stored here. |
| `wicket_type` | null, `bowled`, `caught`, `run_out`, `stumped`, `lbw`, or `hit_wicket`. |
| `dismissed_id` | Null unless there is a wicket. |
| `fielder_id` | Required for `caught`, `stumped`, and `run_out`. Otherwise null. |
| `over_index` | Optional hint. See hints. |
| `ball_in_over` | Optional hint. See hints. |

`seq` of a new ball is exactly one greater than the highest `seq` ever stored for the match, including voided rows. Any other new `seq` is `seq_gap`. A `client_uuid` that is already stored is not applied again. If the stored delivery fields differ, the error is `uuid_conflict`. Delivery fields are `seq`, `innings_number`, `striker_id`, `non_striker_id`, `bowler_id`, `runs_bat`, `extra_type`, `extra_runs`, `wicket_type`, `dismissed_id`, and `fielder_id`. Hint differences alone do not conflict. A rejected ball stores nothing and does not consume a `seq` or a uuid.

## Runs

The engine adds the penalty. On a no-ball, `extra_runs` are byes and stay in the no-ball extras bucket, not in `bye`.

| `extra_type` | Team runs | Batter runs | Bowler runs | Extras bucket | Legal ball | Ball faced | Runs that can swap strike |
| --- | --- | --- | --- | --- | --- | --- | --- |
| null | `runs_bat` | `runs_bat` | `runs_bat` | none | yes | yes | `runs_bat` |
| `bye` | `extra_runs` | 0 | 0 | `bye` | yes | yes | `extra_runs` |
| `leg_bye` | `extra_runs` | 0 | 0 | `leg_bye` | yes | yes | `extra_runs` |
| `wide` | `wide_runs + extra_runs` | 0 | `wide_runs + extra_runs` | `wide` gets both | no | no | `extra_runs` only |
| `no_ball` | `no_ball_runs + runs_bat + extra_runs` | `runs_bat` | all of the team runs | `no_ball` gets `no_ball_runs + extra_runs` | no | yes | `runs_bat + extra_runs` |

`runs_bat` must be 0 on a wide (`wide_with_bat_runs`), a bye (`bye_with_bat_runs`), and a leg-bye (`leg_bye_with_bat_runs`).

`fours` increments when `runs_bat` is 4. `sixes` increments when `runs_bat` is 6. Byes never count as fours or sixes. A four off a no-ball does.

`extras.total` is `wide + no_ball + bye + leg_bye`. Innings runs equal the sum of batting-card runs plus `extras.total`. The sum of bowler-card runs equals innings runs minus `bye` minus `leg_bye`.

## Wickets

`bowled`, `lbw`, `hit_wicket`, `caught`, and `stumped` credit the bowler. `run_out` does not.

- On a no-ball the only legal wicket is `run_out` (`no_ball_illegal_wicket`).
- On a wide the only legal wickets are `run_out` and `stumped` (`wide_illegal_wicket`). A stumping off a wide credits the bowler and is not a legal ball.
- On a bye or a leg-bye the only legal wicket is `run_out` (`bye_illegal_wicket`).

`caught`, `stumped`, and `run_out` require `fielder_id` (`missing_fielder`). The fielder is a bowling-side player and may be the bowler. Any other wicket, including no wicket, must have `fielder_id` null (`unexpected_fielder`).

`wicket_type` and `dismissed_id` are both null or both set. `bowled`, `lbw`, `hit_wicket`, `caught`, and `stumped` dismiss the event's striker. `run_out` dismisses the striker or the non-striker. Anything else is `illegal_dismissal`.

One ball dismisses at most one player. The fall-of-wicket entry is appended after that ball's runs are added: `{ "wicket": <1-based count>, "runs": <team total>, "batter_id": <dismissed_id> }`.

Dismissal text uses player names, not ids, with these exact templates:

| Type | Text |
| --- | --- |
| not out | `not out` |
| bowled | `b {bowler}` |
| caught | `c {fielder} b {bowler}` |
| run out | `run out ({fielder})` |
| stumped | `st {fielder} b {bowler}` |
| lbw | `lbw b {bowler}` |
| hit wicket | `hit wicket b {bowler}` |

A dismissal bars that player from batting or bowling for the rest of that innings only (`dismissed_player_bats_again` if they are named as striker, non-striker, or bowler). It does not bar them in the other innings. A batter who was out while batting may bowl when their side fields.

## Overs, cards, tokens, hints

An over is 6 legal balls. Wides and no-balls do not add to the legal count.

The derived overs object is built from the legal-ball count `L`:

```text
overs = L // 6
balls = L % 6
display = "{overs}.{balls}"
```

Six legal balls is `{ "overs": 1, "balls": 0, "display": "1.0" }`, not `0.6`. A bowler's overs use the same shape and count only legal balls they bowled. A bowler who has bowled only wides is `0.0` and is still on the card.

The bowling card gains a row the first time that player delivers any ball, including a wide or no-ball. Row order is first-delivery order.

The batting card lists everyone who has taken the crease, in appearance order, including a partner on 0 balls. Players who never appear are omitted. Openers are inserted at innings start. A later batter is inserted on the ball that first names them.

A maiden is awarded when a bowler delivers all 6 legal balls of a completed over and the bowler-charged runs in that over are 0. Byes and leg-byes do not spoil it. A wide or a no-ball does. A shared over is not a maiden for anyone.

Ball tokens, one per delivery, in the over they were attempted in:

```text
wide, extra_runs == 0            -> wd
wide, extra_runs > 0             -> wd+{extra_runs}
no-ball, runs_bat + extra_runs 0 -> nb
no-ball, otherwise               -> nb+{runs_bat + extra_runs}
bye                              -> {extra_runs}b
leg-bye                          -> {extra_runs}lb
anything else                    -> {runs_bat}
```

If the delivery is a wicket, append `W`, except a base of `0` becomes `W` rather than `0W`. Examples: `1`, `4`, `6`, `0`, `wd`, `wd+1`, `nb`, `nb+4`, `nbW`, `1b`, `1lb`, `W`, `1W`.

`overs_timeline` is a list of overs. Each over is a list of tokens. The first ball opens a list. The ball that completes an over stays in that list. The next ball opens the next list. Do not emit an empty list for an over that has not started. An over with extras has more than 6 tokens.

Hints are per innings, from the legal balls `L` already applied before this delivery:

```text
over_index = L // 6
ball_in_over = (L % 6) + 1
```

A wide or no-ball leaves the next delivery on the same `ball_in_over`. Omit both hints, or send both. One without the other, or a value that disagrees, is `hint_mismatch`. The engine stores and serves its own values.

The bowler who delivers the 6th legal ball of an over is the bowler of that over. While `needs_new_bowler` is true, that bowler cannot deliver the next over (`same_bowler_consecutive_overs`). A bowler who only delivered earlier balls of a shared over is not barred. Mid-over changes are allowed: any not-out bowling-side player may bowl. The first delivery of an innings must still be `opening_bowler_id` (`opening_bowler_required`).

## Strike

Swap runs are the last column of the runs table. A swap happens when that number is odd and there is no wicket. A wicket suppresses the run swap. The dismissed player stays at the end they occupied on the event until the end-of-over swap, if any.

If this delivery is the 6th legal ball, swap the ends again after the run swap. `needs_new_bowler` becomes true unless the innings also ends.

If `non_striker_id` is null, every swap is a no-op, including the end of an over.

`needs_new_batter` is computed after those swaps. It names the end the dismissed player occupies in the resulting state: `striker`, `non_striker`, or null when nobody was dismissed. The next event supplies the replacement. This event still leaves the dismissed player in that slot and marks them out on the card.

Worked endings. Unless a row says the batter is alone, the crease at the start of that delivery is striker `a1`, non-striker `a2`:

| Delivery | Resulting striker | Resulting non-striker | `needs_new_batter` | `needs_new_bowler` |
| --- | --- | --- | --- | --- |
| `a1` bowled, not the 6th legal ball | `a1` (out) | `a2` | `striker` | false |
| `a1` bowled on the 6th legal ball, innings continues | `a2` | `a1` (out) | `non_striker` | true |
| `a2` run out, not the 6th | `a1` | `a2` (out) | `non_striker` | false |
| `a2` run out on the 6th, innings continues | `a2` (out) | `a1` | `striker` | true |
| legal single on the 6th | `a1` | `a2` | null | true |
| legal dot on the 6th | `a2` | `a1` | null | true |
| single while `a2` bats alone, not the 6th ball | `a2` | null | null | false |
| single while `a2` bats alone on the 6th, innings continues | `a2` | null | null | true |

When the non-striker is null the ends do not change. `needs_new_bowler` still follows the over rule.

The next ball must match the resulting crease:

- `needs_new_batter` null: send the same striker and the same non-striker, including null.
- `striker`: the non-striker stays. The new striker is a not-out batting-side player other than the non-striker. If nobody qualifies, the non-striker comes across, `striker_id` is that player, and `non_striker_id` is null.
- `non_striker`: the striker stays. The new non-striker is a not-out batting-side player other than the striker, or null when the striker is the last not-out batter.

Any other crease is `crease_mismatch`. The client picks which eligible waiting batter comes in.

`last_man_stands: true` means the side is all out only when every player is out (`wickets >= player_count`). The last not-out batter continues alone with `non_striker_id` null.

`last_man_stands: false` means the side is all out when `wickets >= player_count - 1`. Two batters are required, so the innings ends before anyone bats alone.

`player_count` is the size of the batting squad, not the number of players who have already batted.

## Innings end, result, rates

After the ball has added its runs and its wicket, the innings ends if any of these is true:

- legal balls bowled `>= overs * 6`
- the batting side is all out
- the innings is innings 2 and runs `>= target`

Ending clears `needs_new_batter` to null and `needs_new_bowler` to false, even when the ending ball was a wicket or the 6th legal ball. That innings' `complete` becomes true. The dismissed player may still sit in `striker_id` or `non_striker_id`.

Innings 1 ending sets match status to `innings_break` and leaves `result` null. Innings 2 ending sets status to `complete` and sets `result`. There is no super over.

Innings 2 result, in this order:

1. Runs `>= target`: batting side wins. `margin` is the all-out threshold minus wickets fallen. `margin_unit` is `wickets`. This wins even if the same ball also completed the all-out, in which case the margin may be 0.
2. Else runs `== target - 1`: `{ "tie": true }`.
3. Else the bowling side wins by `target - 1 - runs` runs.

```json
{ "winner_team_id": "B", "margin": 1, "margin_unit": "wickets" }
```

```json
{ "tie": true }
```

Rates are set only while status is `innings_2`. Otherwise `crr`, `rrr`, and `runs_needed` are null.

```text
runs_needed = max(target - runs, 0)
crr = runs * 6 / legal_balls          null when legal_balls is 0
rrr = runs_needed * 6 / balls_left    null when balls_left is 0
balls_left = overs * 6 - legal_balls
```

Round half away from zero to 2 decimal places, using decimal arithmetic. `10 * 6 / 11` is `5.45`. A whole number is a JSON number with no fractional part (`6`, which is the same value as `6.0`). Compare parsed numbers, not their spelling.

## Undo

`undo` voids the non-voided ball with the highest `seq` and recomputes. It does not delete the row, free the `seq`, or free the `client_uuid`. It does not un-start an innings. If every ball of a started innings is void, the state is the post-start state of that innings, including innings 2 at `0/0` with its target and rates. Undo with nothing non-voided to void is `nothing_to_undo`.

Recompute from a fresh `not_started` state: for each started innings in order, apply the innings start, then its non-voided balls in `seq` order.

## Derived state

`not_started`, before any innings start:

```json
{
  "status": "not_started",
  "result": null,
  "overs": 1,
  "rules": { "wide_runs": 1, "no_ball_runs": 1, "last_man_stands": true },
  "teams": [{ "id": "A", "name": "A" }, { "id": "B", "name": "B" }],
  "innings": [],
  "striker_id": null,
  "non_striker_id": null,
  "bowler_id": null,
  "needs_new_batter": null,
  "needs_new_bowler": false,
  "crr": null,
  "rrr": null,
  "runs_needed": null
}
```

`teams` is setup order, id and name only. `overs` is the scheduled overs. `rules` is the resolved rules. Each innings object also has `complete`. Those four fields are part of `MatchState` so a public payload stands alone and so an ended innings is visible while the other innings is live.

Every derived innings satisfies:

- batting runs + `extras.total` = `runs`
- `extras.total` = `wide + no_ball + bye + leg_bye`
- bowling runs = `runs - bye - leg_bye`
- `wickets` = fall-of-wicket length = number of batting rows with `out: true`
- bowling wickets = `wickets` minus rows whose dismissal starts with `run out`
- bowling legal balls = innings legal balls

`bowler_id` stays as the opening bowler until a ball is bowled, then as the bowler of the last delivery, even when `needs_new_bowler` is true.

## Errors

First match wins:

1. `seq_gap`
2. `uuid_conflict`
3. `innings_not_ready`
4. `innings_closed`
5. `player_not_on_team`
6. `dismissed_player_bats_again`
7. `crease_mismatch`
8. `opening_bowler_required`
9. `same_bowler_consecutive_overs`
10. `wide_with_bat_runs`
11. `bye_with_bat_runs`
12. `leg_bye_with_bat_runs`
13. `no_ball_illegal_wicket`
14. `wide_illegal_wicket`
15. `bye_illegal_wicket`
16. `illegal_dismissal`
17. `missing_fielder`
18. `unexpected_fielder`
19. `hint_mismatch`

`player_not_on_team`: striker, a non-null non-striker, and a non-null dismissed id must be on the batting side; bowler and a non-null fielder must be on the bowling side.

`innings_closed`: the ball names an innings that is not the open one, or that innings is already complete. `innings_not_ready`: that innings has not been started and the match is not ready for it. A ball does not create an innings. `POST /innings` does. The fixture runner applies the matching `innings` entry before the ball, and a rejected ball does not undo that start.

`nothing_to_undo` is the undo error and is not a ball error.

## Fixture runner

Valid file: `setup`, `innings`, `ops`, `expect`. Invalid file: those, plus `illegal` and `expect_error`.

`setup.rules` may omit keys; default them before play. Each `innings` entry is an innings-start body. `ops` contains `{ "op": "ball", "event": BallEvent }` and `{ "op": "undo" }` only.

1. Build the match from `setup`. Status is `not_started`.
2. For each op, in order: a ball starts its innings if that innings is not started yet, then applies; undo voids and recomputes.
3. A valid fixture's state deep-equals `expect`.
4. For an invalid fixture, after `ops`, start the illegal ball's innings if it is not started. That start remains. Applying the illegal ball raises `expect_error` and does not change any field. The state deep-equals `expect`.

Deep-equal the parsed JSON values. Do not rename fields, drop zeros, or translate tokens.
