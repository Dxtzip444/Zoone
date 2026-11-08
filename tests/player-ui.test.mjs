import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../theme.js", import.meta.url), "utf8");

test("startup uses an available native player without replacing an existing bridge", () => {
  const prefix = source.slice(0, source.indexOf("  const root = document.documentElement;"));
  for (const existing of [null, { _state: { isPaused: true } }]) {
    const native = { _state: { isPaused: false } };
    const player = { addEventListener() {}, isPlaying() { return !this.origin._state.isPaused; } };
    if (existing) player.origin = existing;
    const window = { Spicetify: { Platform: { History: {}, PlayerAPI: native }, Player: player, LocalStorage: {} } };
    vm.runInNewContext(`${prefix}\n})();`, {
      window, document: { getElementById: () => ({}), querySelector: () => ({}) },
      setTimeout() { throw Error("Ready player should not leave the theme waiting"); },
    });
    assert.equal(player.origin, existing || native);
    assert.equal(window.__zuneTheme, true);
  }
});

test("popup mute activates Spotify's current native control with a wrapper fallback", () => {
  const start = source.indexOf('  muteBtn.addEventListener("click",');
  const code = source.slice(start, source.indexOf('  document.addEventListener("pointerdown",', start));
  let click, nativeClicks = 0, wrapperClicks = 0;
  let native = { disabled: false, click() { nativeClicks++; } };
  vm.runInNewContext(code, {
    muteBtn: { addEventListener(type, listener) { click = listener; } },
    $: () => native, S: { Player: { toggleMute() { wrapperClicks++; } } },
    setTimeout() {}, renderVolume() {},
  });
  click();
  assert.equal(nativeClicks, 1);
  assert.equal(wrapperClicks, 0);
  native = null;
  click();
  assert.equal(wrapperClicks, 1);
});

function element() {
  return {
    parentElement: null,
    children: [],
    append(node) {
      if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(n => n !== node);
      node.parentElement = this;
      this.children.push(node);
    },
  };
}

test("mount keeps the readout with the native slider and recovers replaced volume controls", () => {
  const bar = element();
  const nativeButton = element(), nativeSlider = element();
  let host = element();
  host.append(nativeButton);
  host.append(nativeSlider);
  const volEl = element();
  bar.querySelector = () => host;
  const code = source.slice(source.indexOf("  function mount() {"), source.indexOf("  // The app frame should never scroll"));
  const env = vm.createContext({
    document: { getElementById: () => null }, $: () => bar,
    fillA: element(), fillB: element(), npButton: element(), volEl,
    setVolPop() {}, tagDom() {}, watchChildren() {},
    browser: { syncCovered() {} }, libObserver: null,
  });
  vm.runInContext(`${code}\nmount();`, env);
  assert.equal(volEl.parentElement, host);
  assert.deepEqual(host.children, [nativeButton, nativeSlider, volEl]);
  vm.runInContext("mount(); mount();", env);
  assert.equal(host.children.filter(n => n === volEl).length, 1);

  host = null; // Spotify removes the native volume group during a redraw.
  vm.runInContext("mount();", env);
  assert.equal(volEl.parentElement, bar);
  host = element();
  vm.runInContext("mount();", env);
  assert.equal(volEl.parentElement, host);
  assert.ok(!bar.children.includes(volEl));
});

test("structural redraws repair controls on one frame, while clock text updates stay idle", () => {
  const observers = [], frames = [];
  let mounts = 0;
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(node, options) { this.node = node; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const start = source.indexOf("  const watched = new Map();");
  const code = source.slice(start, source.indexOf("  // re-tag soon", start));
  const env = vm.createContext({
    window: { MutationObserver: Observer }, MutationObserver: Observer,
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    mount() { mounts++; },
  });
  const node = { isConnected: true };
  env.node = node;
  vm.runInContext(`${code}\nwatchChildren(node, true); watchChildren(node, true);`, env);
  assert.equal(observers.length, 1);
  assert.equal(observers[0].options.subtree, true);
  observers[0].callback([{ addedNodes: [{ nodeType: 3 }], removedNodes: [{ nodeType: 3 }] }]);
  assert.equal(frames.length, 0);
  const redraw = [{ addedNodes: [], removedNodes: [{ nodeType: 1 }] }];
  observers[0].callback(redraw);
  observers[0].callback(redraw);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(mounts, 1);
  node.isConnected = false;
  env.node = { isConnected: true };
  vm.runInContext("watchChildren(node, true);", env);
  assert.equal(observers[0].disconnected, true);
});

test("slow pointer movement accumulates as activity while resting jitter is ignored", () => {
  let now = 0;
  const code = source.slice(source.indexOf("  let lastInput = Date.now();"), source.indexOf("  function syncInert()"));
  const env = vm.createContext({ Date: { now: () => now }, mix: { isOpen: false }, settings: {} });
  vm.runInContext(`${code}\nglobalThis.move = x => noteActivity({type: 'pointermove', screenX: x, screenY: 0}); globalThis.last = () => lastInput;`, env);
  env.move(0);
  now = 100;
  env.move(1); env.move(0); env.move(1);
  assert.equal(env.last(), 0);
  now = 200;
  for (let x = 2; x <= 8; x++) env.move(x);
  assert.equal(env.last(), 200);
});

test("the idle view stays closed in the background and opens after foreground inactivity", () => {
  const end = source.indexOf("    idleOpened = true;");
  const start = source.lastIndexOf("  setInterval(() => {", end);
  const code = source.slice(start, source.indexOf("  }, 5000);", end) + "  }, 5000);".length);
  let tick, opened = 0;
  const env = vm.createContext({
    document: { hidden: true },
    settings: { idleNowPlaying: true, idleOnlyPlaying: true, idleMinutes: 5 },
    mix: { isOpen: false, open() { opened++; } }, overlays: [],
    S: { Player: { data: { item: {} }, isPlaying: () => true } },
    Date: { now: () => 600000 }, lastInput: 0,
    setInterval(callback) { tick = callback; },
  });
  vm.runInContext(code, env);
  tick();
  assert.equal(opened, 0);
  env.document.hidden = false;
  env.lastInput = 599000;
  tick();
  assert.equal(opened, 0);
  env.lastInput = 0;
  tick();
  assert.equal(opened, 1);
});
