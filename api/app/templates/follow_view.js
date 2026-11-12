function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function roundHalfAway(numerator, denominator) {
  const negative = numerator < 0 !== denominator < 0;
  const scaled = BigInt(Math.abs(numerator)) * 100n;
  const divisor = BigInt(Math.abs(denominator));
  const quotient = scaled / divisor;
  const remainder = scaled % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  const magnitude = Number(rounded) / 100;
  return negative ? -magnitude : magnitude;
}

function strikeRate(runs, balls) {
  if (!balls) return "-";
  return String(roundHalfAway(runs * 100, balls));
}

function economy(runs, legalBalls) {
  if (!legalBalls) return "-";
  return String(roundHalfAway(runs * 6, legalBalls));
}

function inningsCrr(innings) {
  const legal = innings.overs.overs * 6 + innings.overs.balls;
  if (!legal) return null;
  return String(roundHalfAway(innings.runs * 6, legal));
}

function tokenRuns(token, rules) {
  let body = token === "W" ? "0" : token.endsWith("W") ? token.slice(0, -1) : token;
  if (body === "wd") return rules.wide_runs;
  if (body.startsWith("wd+")) return rules.wide_runs + Number(body.slice(3));
  if (body === "nb") return rules.no_ball_runs;
  if (body.startsWith("nb+")) return rules.no_ball_runs + Number(body.slice(3));
  if (body.endsWith("lb")) return Number(body.slice(0, -2));
  if (body.endsWith("b")) return Number(body.slice(0, -1));
  return Number(body);
}

function overTotal(tokens, rules) {
  return tokens.reduce((sum, token) => sum + tokenRuns(token, rules), 0);
}

function teamName(state, id) {
  const team = state.teams.find((item) => item.id === id);
  return team ? team.name : id;
}

function cardName(innings, playerId) {
  if (!playerId) return "";
  const row = innings.batting.find((item) => item.player_id === playerId)
    || innings.bowling.find((item) => item.player_id === playerId);
  return row ? row.name : playerId;
}

function resultText(state) {
  const result = state.result;
  if (!result) return "";
  if (result.tie) return "Match tied";
  const unit = result.margin === 1 ? result.margin_unit.slice(0, -1) : result.margin_unit;
  return teamName(state, result.winner_team_id) + " won by " + result.margin + " " + unit;
}

function tossText(state) {
  const toss = state.toss;
  return teamName(state, toss.winner_team_id) + " won the toss and chose to " + toss.decision;
}

function tokenHtml(token) {
  const cls = String(token).endsWith("W") ? "token wicket" : "token";
  return '<span class="' + cls + '">' + esc(token) + "</span>";
}

function creaseHtml(state, latest) {
  if (!latest || !state.striker_id) return "";
  const striker = latest.batting.find((row) => row.player_id === state.striker_id);
  const nonStriker = state.non_striker_id
    ? latest.batting.find((row) => row.player_id === state.non_striker_id)
    : null;
  const bowler = latest.bowling.find((row) => row.player_id === state.bowler_id);
  const strikerRuns = striker ? striker.runs : 0;
  const strikerBalls = striker ? striker.balls : 0;
  let nonStrikerHtml;
  if (!state.non_striker_id) {
    nonStrikerHtml = '<p class="crease-line"><span class="role">Non-striker</span> batting alone</p>';
  } else {
    const runs = nonStriker ? nonStriker.runs : 0;
    const balls = nonStriker ? nonStriker.balls : 0;
    nonStrikerHtml = '<p class="crease-line"><span class="role">Non-striker</span> <span class="who">' +
      esc(cardName(latest, state.non_striker_id)) + "</span> <strong>" + runs + " (" + balls +
      ")</strong> <span class=\"rate\">SR " + strikeRate(runs, balls) + "</span></p>";
  }
  const figures = bowler
    ? bowler.overs.display + "-" + bowler.maidens + "-" + bowler.runs + "-" + bowler.wickets
    : "0.0-0-0-0";
  const legal = bowler ? bowler.overs.overs * 6 + bowler.overs.balls : 0;
  const bowlerName = bowler ? bowler.name : (state.bowler_id || "—");
  const pair = latest.partnerships[latest.partnerships.length - 1];
  return '<section class="crease"><h2>At the crease</h2>' +
    '<p class="crease-line"><span class="role">Striker</span> <span class="who">' +
    esc(cardName(latest, state.striker_id)) + "</span> <strong>" + strikerRuns + " (" + strikerBalls +
    ")</strong> <span class=\"rate\">SR " + strikeRate(strikerRuns, strikerBalls) + "</span></p>" +
    nonStrikerHtml +
    '<p class="crease-line"><span class="role">Bowler</span> <span class="who">' + esc(bowlerName) +
    "</span> <strong>" + esc(figures) + "</strong> <span class=\"rate\">Econ " +
    economy(bowler ? bowler.runs : 0, legal) + "</span></p>" +
    '<p class="crease-line"><span class="role">Partnership</span> <strong>' + pair.runs + " (" +
    pair.balls + ")</strong></p></section>";
}

function recentOversHtml(state, latest) {
  if (!latest || !latest.overs_timeline.length) {
    return '<section class="over-row"><h2>Recent overs</h2><p class="empty">No balls yet</p></section>';
  }
  const timeline = latest.overs_timeline;
  const start = Math.max(0, timeline.length - 4);
  const rows = timeline.slice(start).map((over, index) => {
    const number = start + index + 1;
    return '<div class="over-line"><span class="over-label">Over ' + number + '</span><div class="tokens">' +
      over.map(tokenHtml).join("") + '</div><strong class="over-total">' +
      overTotal(over, state.rules) + "</strong></div>";
  }).join("");
  return '<section class="over-row"><h2>Recent overs</h2>' + rows + "</section>";
}

function partnershipRows(innings) {
  return innings.partnerships.map((pair) => {
    let batters = esc(cardName(innings, pair.batter1_id)) + " " + pair.batter1_runs + " (" + pair.batter1_balls + ")";
    if (pair.batter2_id) {
      batters += ", " + esc(cardName(innings, pair.batter2_id)) + " " + pair.batter2_runs + " (" + pair.batter2_balls + ")";
    }
    return "<tr><td>" + pair.wicket + "</td><td>" + batters + "</td><td>" + pair.runs + " (" + pair.balls + ")</td></tr>";
  }).join("");
}

function inningsHtml(state, innings) {
  const fow = innings.fall_of_wickets.length
    ? innings.fall_of_wickets.map((item) => {
        const batter = innings.batting.find((row) => row.player_id === item.batter_id);
        return item.wicket + "-" + item.runs + " (" + esc(batter ? batter.name : item.batter_id) + ")";
      }).join(", ")
    : "none yet";
  const batting = innings.batting.map((row) =>
    '<tr class="' + (row.out ? "out" : "") + '"><td><span class="name">' + esc(row.name) +
    '</span><span class="how">' + esc(row.dismissal) + "</span></td><td>" + row.runs +
    "</td><td>" + row.balls + "</td><td>" + row.fours + "</td><td>" + row.sixes +
    "</td><td>" + strikeRate(row.runs, row.balls) + "</td></tr>"
  ).join("");
  const bowling = innings.bowling.length
    ? '<table><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody>' +
      innings.bowling.map((row) => {
        const legal = row.overs.overs * 6 + row.overs.balls;
        return "<tr><td>" + esc(row.name) + "</td><td>" + esc(row.overs.display) + "</td><td>" +
          row.maidens + "</td><td>" + row.runs + "</td><td>" + row.wickets + "</td><td>" +
          economy(row.runs, legal) + "</td></tr>";
      }).join("") + "</tbody></table>"
    : '<p class="empty">Yet to bowl</p>';
  const rate = inningsCrr(innings);
  const target = innings.target ? " · Target " + innings.target : "";
  const crr = rate ? " · CRR " + rate : "";
  return '<section class="block"><div class="block-head"><h2>Innings ' + innings.innings_number +
    "</h2><strong>" + esc(teamName(state, innings.batting_team_id)) + " " + innings.runs + "/" +
    innings.wickets + " (" + esc(innings.overs.display) + ")</strong></div>" +
    '<p class="facts">Extras Wd ' + innings.extras.wide + " · Nb " + innings.extras.no_ball +
    " · B " + innings.extras.bye + " · Lb " + innings.extras.leg_bye + " · Total " + innings.extras.total +
    target + crr + "</p>" +
    '<p class="facts">Fall of wickets: ' + fow + "</p>" +
    '<div class="cards"><div><h3>Batting</h3><table><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>' +
    batting + "</tbody></table></div><div><h3>Bowling</h3>" + bowling + "</div></div>" +
    '<h3>Partnerships</h3><table><thead><tr><th>Wkt</th><th>Batters</th><th></th></tr></thead><tbody>' +
    partnershipRows(innings) + "</tbody></table></section>";
}

function boardHtml(state) {
  const latest = state.innings.length ? state.innings[state.innings.length - 1] : null;
  const first = state.innings.length > 1 ? state.innings[0] : null;
  let hero = '<p class="score">–</p><p class="overs">Waiting for the openers</p>';
  if (latest) {
    hero = '<p class="score">' + latest.runs + "/" + latest.wickets + "</p>" +
      '<p class="overs">' + esc(teamName(state, latest.batting_team_id)) + " · " +
      esc(latest.overs.display) + " overs</p>";
    if (first) {
      hero += '<p class="summary">' + esc(teamName(state, first.batting_team_id)) + " " +
        first.runs + "/" + first.wickets + " (" + esc(first.overs.display) + ")</p>";
    }
  }
  const bits = [];
  if (state.runs_needed !== null && state.runs_needed !== undefined) bits.push("Need " + state.runs_needed);
  if (state.crr !== null && state.crr !== undefined) bits.push("CRR " + state.crr);
  if (state.rrr !== null && state.rrr !== undefined) bits.push("RRR " + state.rrr);
  if (bits.length) hero += '<p class="rates">' + esc(bits.join(" · ")) + "</p>";
  const result = resultText(state);
  if (result) hero += '<p class="result">' + esc(result) + "</p>";
  return '<p class="kicker">Gully Cricket</p>' +
    "<h1>" + esc(state.teams[0].name) + " <span>vs</span> " + esc(state.teams[1].name) + "</h1>" +
    '<p class="meta">' + state.overs + " overs a side · " + esc(state.status.replaceAll("_", " ")) +
    '<span id="live" class="live"></span></p>' +
    '<p class="meta">' + esc(tossText(state)) + "</p>" +
    '<section class="hero">' + hero + "</section>" +
    creaseHtml(state, latest) +
    recentOversHtml(state, latest) +
    state.innings.map((innings) => inningsHtml(state, innings)).join("");
}
