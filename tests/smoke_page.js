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
;return { get S(){ return S; }, get SIGNALS(){ return SIGNALS; }, outcomeDist };`;
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
  console.log("C3 smoke OK — frozen #v3 hash parses, model renders");
}, 50);
