import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../theme.js", import.meta.url), "utf8");
const track = "spotify:track:current";
const album = "spotify:album:current";
const liked = "spotify:user:test:collection";
const state = (context = album, isPaused = false) => ({ item: { uri: track }, context: { uri: context }, isPaused });

function playerHarness(initial = state()) {
  const calls = [], messages = [], timers = new Map();
  const menuUpdates=[];
  let sequence = 0;
  const Player = { data: initial };
  for (const name of ["playUri", "pause", "play"]) Player[name] = (...args) => { calls.push({ name, args }); };
  const env = vm.createContext({
    S: { Player }, shown: false, songList: null, body: { querySelectorAll: () => [] },
    syncActions() {}, notify: (...args) => messages.push(args),
    menu: { onPlaybackChange: () => menuUpdates.push(true) },
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const code = source.slice(source.indexOf("    const footers = new Map();"), source.indexOf("    const bars = () =>"));
  vm.runInContext(`${code}\nglobalThis.api={activatePlayback,refreshPlayback,snapshot,get pending(){return pendingPlayback}};`, env);
  return { api: env.api, Player, calls, messages, timers, menuUpdates };
}

test("a focused footer restores its URI only against the replacement list", () => {
  const a={uri:'spotify:album:a',name:'A'},b={uri:'spotify:album:b',name:'B'};
  const oldBox={_items:[a,b],_active:1};
  const f={box:oldBox,restore:null,button:{},reason:{}};
  const env=vm.createContext({
    footers:new Map([['album',f]]),songSource:{},
    document:{activeElement:{closest:()=>({dataset:{kind:'album'}})}},
    setActive:(box,i)=>{box._active=i},title:x=>x.name,
    playbackAction:(_kind,item)=>({item,action:'Play',reason:item?'':'Choose an item first.'}),
    setText:(node,text)=>{node.textContent=text},setAttr:(node,key,value)=>{node[key]=value},
  });
  const code=source.slice(source.indexOf('    function rememberActionFocus('),source.indexOf('    function inlinePlayback('));
  vm.runInContext(`${code}\nrememberActionFocus('song');syncActions();`,env);
  assert.equal(f.box,oldBox,'replacing another column must not unbind this action');
  vm.runInContext('rememberActionFocus();syncActions();',env);
  assert.equal(f.restore?.uri,b.uri,'constructing other lists must not consume the saved target');
  const replacement={_items:[b,a],_active:1};f.box=replacement;
  vm.runInContext('syncActions()',env);
  assert.equal(replacement._items[replacement._active].uri,b.uri);
  assert.equal(f.button.textContent,'Play B');
});

test("context-only stream and polling updates notify the open menu", () => {
  const h=playerHarness(state(album));
  h.Player.data=state('spotify:album:other');
  h.api.refreshPlayback();
  assert.equal(h.menuUpdates.length,1);
  h.api.refreshPlayback(state('spotify:album:third'));
  assert.equal(h.menuUpdates.length,2);
  h.api.refreshPlayback(state('spotify:album:third'));
  assert.equal(h.menuUpdates.length,2,'unchanged state needs no menu update');
});

test("startup waits when exposed player methods still throw", () => {
  let retries = 0;
  const window = { Spicetify: { Platform: { History: {} }, Player: { addEventListener() {}, isPlaying() { throw Error("state not ready"); } }, LocalStorage: {} } };
  const prefix = source.slice(0, source.indexOf("  const root = document.documentElement;"));
  vm.runInNewContext(`${prefix}\n})();`, { window, document: { getElementById: () => ({}), querySelector: () => ({}) }, setTimeout: () => retries++ });
  assert.equal(retries, 1);
  assert.equal(window.__zuneTheme, undefined);
});

test("same track from another context pauses without replacing context", () => {
  const h = playerHarness(state(liked));
  h.api.activatePlayback("song", { uri: track }, album);
  assert.deepEqual(h.calls.map(x => x.name), ["pause"]);
  h.Player.data = state(liked, true);
  h.api.refreshPlayback();
  assert.equal(h.api.pending, null);
  assert.equal(h.Player.data.context.uri, liked);
});

test("an album containing the track does not pause a different context", () => {
  const h = playerHarness(state(liked));
  h.api.activatePlayback("album", { uri: album });
  assert.equal(h.calls[0].name, "playUri");
  assert.equal(h.calls[0].args[0], album);
  assert.ok(h.api.pending);
  h.Player.data = state(album);
  h.api.refreshPlayback();
  assert.equal(h.api.pending, null, "context-only acknowledgement settles the request");
});

test("pause/resume wrappers need no promise and repeated activation is bounded", () => {
  const h = playerHarness(state(album, true));
  h.api.activatePlayback("album", { uri: album });
  h.api.activatePlayback("album", { uri: album });
  assert.deepEqual(h.calls.map(x => x.name), ["play"]);
  h.Player.data = state(album, false);
  h.api.refreshPlayback();
  assert.equal(h.api.pending, null);
  assert.equal(h.timers.size, 0);
});

test("starting a different song passes its displayed context and URI", () => {
  const h = playerHarness();
  const next = "spotify:track:next";
  h.api.activatePlayback("song", { uri: next }, liked);
  assert.equal(h.calls[0].args[0], liked);
  assert.equal(h.calls[0].args[2].skipTo.uri, next);
});

test("unknown playback state and unavailable items cannot trigger writes", () => {
  const h = playerHarness(null);
  h.api.activatePlayback("song", { uri: track }, liked);
  assert.equal(h.calls.length, 0);
  h.Player.data = state();
  h.api.activatePlayback("album", { uri: "spotify:album:other", isPlayable: false });
  assert.equal(h.calls.length, 0);
});

test("a silent update still confirms the state at the deadline", () => {
  const h = playerHarness(state(liked));
  h.api.activatePlayback("album", { uri: album });
  h.Player.data = state(album);
  [...h.timers.values()][0]();
  assert.equal(h.api.pending, null);
  assert.equal(h.messages.length, 0);
});

test("an unconfirmed deadline releases the pending action without retry", () => {
  const h = playerHarness();
  h.api.activatePlayback("album", { uri: "spotify:album:other" });
  [...h.timers.values()][0]();
  assert.equal(h.api.pending, null);
  assert.equal(h.calls.length, 1);
  assert.match(h.messages[0][0], /could not be confirmed/);
});

test("a rejected start and a synchronous toggle error release pending state", async () => {
  const h = playerHarness();
  h.Player.playUri = () => Promise.reject(Error("unavailable"));
  h.api.activatePlayback("album", { uri: "spotify:album:other" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.api.pending, null);
  h.Player.pause = () => { throw Error("disconnected"); };
  h.api.activatePlayback("song", { uri: track }, album);
  assert.equal(h.api.pending, null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.messages.length, 2);
});

test("the missing Friends control gives an explicit fallback", () => {
  const messages=[];
  const code=source.slice(source.indexOf("  function clickFriendsPanel()"),source.indexOf("  function focusSearch()"));
  vm.runInNewContext(`${code}\nclickFriendsPanel();`,{document:{querySelector:()=>null,querySelectorAll:()=>[]},notify:(...args)=>messages.push(args)});
  assert.equal(messages.length,1);
  assert.match(messages[0][0],/unavailable/);
});

test("asynchronous menu relabel keeps Play and Pause separate", () => {
  const actions=[{key:'menuPlay',label:()=> 'Play'},{key:'menuPlay',id:'menuPlaybackToggle',label:()=> 'Pause'}];
  const buttons=[{dataset:{key:'menuPlay'}},{dataset:{key:'menuPlaybackToggle'}}];
  const code=source.slice(source.indexOf('    function relabel()'),source.indexOf('    async function openSub('));
  vm.runInNewContext(`${code}\nrelabel();`,{visible:()=>actions,ACTIONS:actions,items:()=>buttons,el:{contains:()=>false},ctx:{},build:()=>{throw Error('Unnecessary menu rebuild')}});
  assert.deepEqual(buttons.map(b=>b.textContent),['Play','Pause']);
});

test("playing colors retain text contrast across custom gradients and selection", () => {
  const helpers=source.slice(source.indexOf("  function normHex("),source.indexOf("  function rgbToHsl("));
  const palette=source.slice(source.indexOf("    function refreshPlayingColors()"),source.indexOf("    function revealPlaying()"));
  const parse=s=>s.match(/[\d.]+/g).map(Number);
  const blend=(a,b,t)=>a.map((v,i)=>v*(1-t)+b[i]*t);
  const luminance=c=>c.map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
  const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  for(const [main,a,b]of [['#ffffff','#ec008c','#f7941d'],['#121212','#ffd600','#ffffff'],['#777777','#000000','#ffffff'],['#ffffff','#ffffff','#ffffff'],['#000000','#000000','#000000']]){
    const values={},vars={'--spice-main':main,'--zune-line-a':a,'--zune-line-b':b};
    const env=vm.createContext({root:{},settings:{playingHighlight:'gradient',highContrast:false,accentLines:'gradient'},getComputedStyle:()=>({getPropertyValue:k=>vars[k]}),el:{style:{setProperty:(k,v)=>values[k]=v}}});
    vm.runInContext(`${helpers}\n${palette}\nrefreshPlayingColors();`,env);
    const bg=parse(values['--zb-playing-bg']),ink=parse(values['--zb-playing-ink']),title=parse(values['--zb-playing-title']),alpha=Number(values['--zb-playing-wash']);
    const hex=s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16));
    for(const shade of [0,.03,.07])for(let t=0;t<=32;t++){
      const background=blend(blend(bg,ink,shade),blend(hex(a),hex(b),t/32),alpha);
      assert.ok(contrast(ink,background)>=4.5,`${main} metadata contrast`);
      assert.ok(contrast(title,background)>=4.5,`${main} title contrast`);
    }
    env.settings.highContrast=true;vm.runInContext('refreshPlayingColors()',env);
    assert.equal(Number(values['--zb-playing-wash']),0);
  }
});
