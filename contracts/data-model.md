# Data model

Logical tables for one match. Do not treat this file as a migration. The API still carries the client-supplied team and player id strings.

The ball log is the source of truth. `matches.status` and `match_snapshots` are caches rebuilt by replaying non-voided balls in `seq` order after each accepted write and after each undo. A reader may serve `state_json` only when that row was written in the same transaction as the log change it reflects. `state_json` validates against `schemas/match-state.schema.json`.

A dismissal lasts only for that innings. Do not store outs on the player row. The engine derives them from that innings' non-voided balls.

## teams

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Client-supplied. Unique within the match. |
| `name` | text | Not null. |

## players

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Client-supplied. Unique within the match. |
| `name` | text | Not null. Used in dismissal text and on the cards. |
| `team_id` | text | References `teams.id`. |

A multi-match database may key `teams` and `players` by `(match_id, id)` so two matches can both use short ids. Do not expose that extra key in the API. If the physical primary key is global and the client id already exists, `POST /matches` returns 409 `id_conflict` and writes nothing.

## matches

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Server-generated. |
| `public_slug` | text | Unique. Matches `^[A-Za-z0-9_-]{8,64}$`. |
| `team_a_id` | text | References `teams.id`. |
| `team_b_id` | text | References `teams.id`. Distinct from `team_a_id`. |
| `overs` | integer | Positive. Scheduled overs per innings. |
| `rules_json` | json | Resolved rules: `wide_runs`, `no_ball_runs`, `last_man_stands`. |
| `toss_winner` | text | Team id. |
| `toss_decision` | text | `bat` or `bowl`. |
| `status` | text | Cache of derived `status`. |
| `scorer_token_hash` | text | Lower-case hex SHA-256 of the UTF-8 scorer token. Never store the token. |
| `created_at` | timestamptz | UTC, set on insert. |

The plaintext token is returned once from `POST /matches`. It has at least 128 bits of entropy. Compare a presented token by hashing it and checking the digest in constant time.

## innings

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Server-generated. |
| `match_id` | uuid | References `matches.id`. |
| `number` | integer | `1` or `2`. Unique per match. |
| `batting_team_id` | text | Toss-derived. |
| `bowling_team_id` | text | The other team. |
| `striker_id` | text | Opening striker. |
| `non_striker_id` | text | Opening non-striker. Not null on this row. |
| `opening_bowler_id` | text | First delivery must use this bowler. |
| `target` | integer, null | Null on innings 1. On innings 2, innings 1 runs + 1, set when the row is inserted. |

Undo does not delete an innings row. A started innings with no remaining non-voided balls is the post-start state.

## ball_events

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Server-generated. |
| `client_uuid` | uuid | Unique. Kept after void. |
| `match_id` | uuid | References `matches.id`. |
| `innings_id` | uuid | References `innings.id`. |
| `seq` | integer | Unique per match, including voided rows. Not reused. |
| `over_index` | integer | Engine value, 0-based, per innings. |
| `ball_in_over` | integer | Engine value, 1-6. The legal ball this delivery attempted. |
| `batter_id` | text | The event `striker_id`. |
| `non_striker_id` | text, null | Null only when the batter is alone. |
| `bowler_id` | text | |
| `runs_bat` | integer | 0-6. |
| `extra_type` | text, null | `wide`, `no_ball`, `bye`, `leg_bye`, or null. |
| `extra_runs` | integer | `>= 0`. Does not include the wide or no-ball penalty. |
| `wicket_type` | text, null | |
| `dismissed_id` | text, null | |
| `fielder_id` | text, null | |
| `created_at` | timestamptz | UTC, set on insert. Not changed on void. |
| `voided` | boolean | Default false. Undo sets true. Do not delete the row. |

Unique `(match_id, seq)` and unique `client_uuid`.

## match_snapshots

| Column | Type | Notes |
| --- | --- | --- |
| `match_id` | uuid | Primary key. References `matches.id`. |
| `state_json` | json | Derived `MatchState`. |
| `updated_at` | timestamptz | UTC, set on every rebuild. |
