// Headless smoke of the play.html game core: simulate full runs, assert invariants.
// Run: node tests/smoke_play.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "play.html"), "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const mod = { exports: {} };
new Function("module", js)(mod);  // document undefined -> boot() no-ops
const Game = mod.exports;
assert.ok(Game.newGame && Game.step, "Game core exported");

const DT = 1 / 60;

// Run 1: perfect player — paddle teleports under the lowest token.
let st = Game.newGame();
let frames = 0;
while (!st.over && frames < 70 * 60) {
  const lowest = st.tokens.reduce((a, k) => (!a || k.y > a.y ? k : a), null);
  st = Game.step(st, DT, lowest ? lowest.x : Game.CFG.W / 2, false);
  assert.ok(st.heat >= 0 && st.heat <= 1.0001, "heat in bounds: " + st.heat);
  assert.ok(st.users >= 0, "users non-negative");
  frames++;
}
assert.ok(st.over, "game ends");
assert.ok(Math.abs(st.t - Game.CFG.DUR) < 0.1, "ends at IPO time");
assert.ok(Number.isFinite(st.valuation) && st.valuation > 0, "valuation computed: " + st.valuation);
const perfectVal = st.valuation;
assert.ok(perfectVal > Game.CFG.TARGET, "win must be reachable: perfect play $" +
  perfectVal.toFixed(1) + "B vs target $" + Game.CFG.TARGET + "B");

// Run 2: AFK player — catches nothing, must still end cleanly and score ~0.
st = Game.newGame();
frames = 0;
while (!st.over && frames < 70 * 60) { st = Game.step(st, DT, -999, false); frames++; }
assert.ok(st.over && st.valuation < perfectVal, "AFK scores below perfect play");

// Pause-signups mechanic: freeze arms, costs 8% of multiplier, blocks spawns.
st = Game.newGame();
st = Game.step(st, DT, 450, true);
assert.ok(st.freeze > 3.9, "freeze armed");
assert.ok(Math.abs(st.mult - 0.92) < 1e-9, "pause costs growth multiple");
assert.strictEqual(st.pauses, 1, "pause counted");
const tokensBefore = st.tokens.length;
for (let i = 0; i < 60; i++) st = Game.step(st, DT, 450, false);
assert.ok(st.tokens.length <= tokensBefore, "no spawns while frozen");

// Meltdown: force heat to 1, expect meltdown state + user penalty.
st = Game.newGame();
st.heat = 1.02; st.users = 10;  // as after a catch pushes past threshold
st = Game.step(st, DT, 450, false);
assert.strictEqual(st.meltdowns, 1, "meltdown triggers at heat 1");
assert.ok(st.meltT > 2.9 && st.users < 10 && st.tokens.length === 0, "meltdown penalizes and clears");

// Immutability: step returns a new state object.
const a = Game.newGame();
const b = Game.step(a, DT, 100, false);
assert.notStrictEqual(a, b, "step is non-mutating (new object)");
assert.strictEqual(a.t, 0, "input state untouched");

console.log("play smoke OK — perfect-run valuation $" + perfectVal.toFixed(1) + "B (target " + Game.CFG.TARGET + ")");
