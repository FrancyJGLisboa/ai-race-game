// C3 smoke: run the page's inline script under a stub DOM and assert a frozen
// pre-revamp #v3 share hash still parses (id-keyed tokens survive the revamp).
// Run: node tests/smoke_page.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

const FROZEN_V3 = "#v3.35-45-20.weights~y~70*qwen~u~x*ban~n~30*labs~u~x*waico~u~x*ipo~u~x*saturation~u~x.1.40-50-45";

const mkEl = () => ({
  style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {} },
  setAttribute() {}, getAttribute() { return null; },
  appendChild() {}, addEventListener() {},
  querySelectorAll() { return []; },
  textContent: "", innerHTML: "",
});
const els = new Map();
const document = {
  getElementById: (id) => { if (!els.has(id)) els.set(id, mkEl()); return els.get(id); },
  querySelectorAll: () => [],
  createElementNS: () => mkEl(),
};
const window = {
  localStorage: { setItem() {}, removeItem() {}, getItem() { return null; } },
  location: { hash: FROZEN_V3, origin: "", pathname: "" },
};
const sandboxHistory = { replaceState() {} };
const fetchStub = async () => { throw new Error("offline smoke"); };

const body = js + `
;return { get S(){ return S; }, get SIGNALS(){ return SIGNALS; }, outcomeDist, solveTree, solveOpenness };`;
// eslint-disable-next-line no-new-func
const run = new Function("document", "window", "history", "fetch", "navigator", body);
const page = run(document, window, sandboxHistory, fetchStub, {});

setTimeout(() => {  // init() is async; let it settle, then read live bindings
  const { S, SIGNALS, outcomeDist } = page;
  assert.strictEqual(SIGNALS.length, 7, "embedded catalog has 7 signals");
  assert.strictEqual(S.sig.weights, "yes", "v3 hash: weights resolved yes");
  assert.strictEqual(S.pred.weights.p, 70, "v3 hash: weights prediction 70");
  assert.strictEqual(S.sig.ban, "no", "v3 hash: ban refuted");
  assert.strictEqual(S.pred.ban.p, 30, "v3 hash: ban prediction 30");
  assert.strictEqual(S.ban, 1, "v3 hash: extraterritorial premise");
  const { mix } = outcomeDist();
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "outcome distribution sums to 1");

  // Game theory earns its name: SPE computed, and it flips on the ban premise.
  const hosted = page.solveTree(false);
  assert.ok(hosted.chinaPublishes && !hosted.usBans, "SPE hosted-only: publish → no ban");
  const extra = page.solveTree(true);
  assert.ok(!extra.chinaPublishes && extra.usBans, "SPE extraterritorial: keep closed (ban off-path)");
  // Strategic signal: weights likelihood is logistic(net utility), not hand-set.
  const w = SIGNALS.find((s) => s.id === "weights");
  const sig = (x) => 1 / (1 + Math.exp(-x));
  assert.ok(Math.abs(w.L.coord - sig(2)) < 1e-9, "L.weights.coord = logistic(+2)");
  assert.ok(Math.abs(w.L.market - sig(2)) < 1e-9, "L.weights.market = logistic(+2)");
  assert.ok(Math.abs(w.L.theater - 0.5) < 1e-9, "L.weights.theater = logistic(0)");

  // Continuous Move 1 (Mladenovic-style): full openness dominates under hosted-only
  // reach; extraterritorial threat yields an INTERIOR optimum (partial openness).
  const opHosted = page.solveOpenness(false);
  assert.strictEqual(opHosted.omega, 1, "hosted-only: omega* = 1 (open everything)");
  const opExtra = page.solveOpenness(true);
  assert.ok(opExtra.omega > 0 && opExtra.omega < 1,
    "extraterritorial: interior optimum, omega* = " + opExtra.omega);
  assert.ok(Math.abs(opExtra.omega - 0.55) < 0.011, "omega* pins to just under the ban trigger");
  // Argmax sanity: omega* beats its neighbors on the equilibrium payoff curve.
  const payAt = (om, extra) => page.solveOpenness(extra).curve.find((p) => Math.abs(p.om - om) < 1e-9).pay;
  assert.ok(opExtra.pay >= payAt(0.45, true) && opExtra.pay >= payAt(0.65, true), "omega* is a maximum");
  // Endpoint consistency with the discrete PAYOFFS tree.
  assert.ok(Math.abs(payAt(0, false) - 3) < 1e-9 && Math.abs(payAt(1, false) - 8) < 1e-9,
    "continuous endpoints match discrete tree (closed=3, open+noban=8)");

  console.log("C3+GT smoke OK — v3 hash parses, SPE flips, strategic L derived, ω* interior under extra ban");
}, 50);
