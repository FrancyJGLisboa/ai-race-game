// Headless smoke of the play.html strategic core: rival lab, two-loops scoring,
// news-derived world, pause dilemma. Run: node tests/smoke_play.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "play.html"), "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const mod = { exports: {} };
new Function("module", js)(mod);
const Game = mod.exports;
assert.ok(Game.newGame && Game.step && Game.deriveWorld, "Game core exported");

const DT = 1 / 60;
const NOW = Date.UTC(2026, 6, 21, 12, 0, 0);

function run(world, stance, policy) {
  let st = Game.newGame(world, stance);
  let frames = 0;
  while (!st.over && frames < 70 * 60) {
    const lowest = st.tokens.reduce((a, k) => (!a || k.y > a.y ? k : a), null);
    const x = policy === "afk" ? -999 : (lowest ? lowest.x : Game.CFG.W / 2);
    let freeze = false;
    if (policy === "always") freeze = true;
    else if (policy === "adaptive") freeze = st.heat > 0.8;
    st = Game.step(st, DT, x, freeze);
    assert.ok(st.heat >= 0 && st.heat <= 1.0001, "heat in bounds");
    assert.ok(st.users >= 0 && st.adoption >= 0 && st.adoption <= 1, "users/adoption in bounds");
    assert.ok(st.rival >= 0 && st.rival <= 1, "rival in bounds");
    frames++;
  }
  assert.ok(st.over && Math.abs(st.t - Game.CFG.DUR) < 0.1, "ends at IPO time");
  return st;
}
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

// Win reachable, loss possible (C4) — default stance, neutral world, adaptive pausing.
const perfect = run(null, null, "adaptive");
assert.ok(perfect.valuation > Game.CFG.TARGET,
  "win reachable: perfect-adaptive $" + perfect.valuation.toFixed(1) + "B vs target " + Game.CFG.TARGET);
const afk = run(null, null, "afk");
assert.ok(afk.valuation < Game.CFG.TARGET, "AFK loses");

// C1a: openness stance moves BOTH your adoption AND the rival's capability.
const closed = run(null, 0, "adaptive");
const open = run(null, 1, "adaptive");
assert.ok(open.rival > closed.rival, "openness feeds the rival");
assert.ok(open.adoption > closed.adoption, "openness feeds your adoption loop");

// C1b: news moves the world — saturation evidence raises heat, more meltdowns.
const meltCalm = mean([0, 0, 0].map(() => run({ satP: 0 }, 0.5, "never").meltdowns));
const meltHot = mean([0, 0, 0].map(() => run({ satP: 1 }, 0.5, "never").meltdowns));
assert.ok(meltHot > meltCalm, "saturation news → hotter GPUs → more meltdowns");
// ...and official ban resolution suppresses the adoption loop.
const noBan = run({}, 0.5, "adaptive");
const banned = run({ banYes: true, banP: 1 }, 0.5, "adaptive");
assert.ok(banned.adoption < noBan.adoption, "official US ban starves Western adoption");

// C2: pause-signups is a genuine dilemma — no fixed policy dominates adaptive play.
const vNever = mean([0, 0, 0, 0, 0].map(() => run(null, 0.5, "never").valuation));
const vAlways = mean([0, 0, 0, 0, 0].map(() => run(null, 0.5, "always").valuation));
const vAdaptive = mean([0, 0, 0, 0, 0].map(() => run(null, 0.5, "adaptive").valuation));
assert.ok(vAdaptive > vAlways, "adaptive beats always-pause (frozen loop 2)");
assert.ok(vAdaptive > vNever, "adaptive beats never-pause (meltdown tax)");

// Pause mechanics: freeze arms, counts, starves adoption, stops spawns.
let st = Game.newGame(null, 0.5);
st.adoption = 0.5;
st = Game.step(st, DT, 450, true);
assert.ok(st.freeze > 2.9 && st.pauses === 1, "freeze armed and counted");
const adoptBefore = st.adoption;
const tokensBefore = st.tokens.length;
for (let i = 0; i < 60; i++) st = Game.step(st, DT, 450, false);
assert.ok(st.adoption < adoptBefore, "adoption decays while signups paused");
assert.ok(st.tokens.length <= tokensBefore, "no spawns while frozen");

// Meltdown: penalty and clear.
st = Game.newGame(null, 0.5);
st.heat = 1.02; st.users = 10;
st = Game.step(st, DT, 450, false);
assert.ok(st.meltdowns === 1 && st.users < 10 && st.tokens.length === 0, "meltdown penalizes and clears");

// deriveWorld: real catalog evidence → normalized pressures + official flags.
const catalog = {
  signals: [
    { id: "ban", resolved: null, evidence: [
      { date: "2026-07-20", title: "a", url: "u1" }, { date: "2026-07-19", title: "b", url: "u2" },
      { date: "2026-07-18", title: "c", url: "u3" }, { date: "2026-06-01", title: "old", url: "u4" }] },
    { id: "saturation", resolved: null, evidence: [
      { date: "2026-07-21", title: "d", url: "u5" }, { date: "2026-07-21", title: "e", url: "u6" },
      { date: "2026-07-20", title: "f", url: "u7" }, { date: "2026-07-20", title: "g", url: "u8" },
      { date: "2026-07-19", title: "h", url: "u9" }, { date: "2026-07-19", title: "i", url: "u10" }] },
    { id: "weights", resolved: "yes", evidence: [] },
    { id: "qwen", resolved: null, evidence: [] },
  ],
};
const w = Game.deriveWorld(catalog, NOW);
assert.ok(Math.abs(w.banP - 3 / 5) < 1e-9, "ban: 3 fresh of 4 (old one dropped) → 0.6");
assert.strictEqual(w.satP, 1, "saturation capped at 1 (6 fresh)");
assert.strictEqual(w.qwenP, 0, "no qwen evidence → 0");
assert.ok(w.weightsYes === true && w.banYes === false, "official flags mapped");
assert.ok(Game.newGame(w, 0.5).adoption > Game.newGame(null, 0.5).adoption,
  "official weights publication seeds adoption");

// Immutability.
const a = Game.newGame(null, 0.5);
const b = Game.step(a, DT, 100, false);
assert.notStrictEqual(a, b);
assert.strictEqual(a.t, 0, "input state untouched");

console.log("play smoke OK — perfect $" + perfect.valuation.toFixed(1) + "B, adaptive $" +
  vAdaptive.toFixed(1) + "B > never $" + vNever.toFixed(1) + "B / always $" + vAlways.toFixed(1) + "B");
