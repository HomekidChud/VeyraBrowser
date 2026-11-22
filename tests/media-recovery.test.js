import { test } from "node:test";
import assert from "node:assert/strict";
import { mountTikTokPlayer } from "../web/src/tiktok.js";
import { wireYouTubeDesk } from "../web/src/youtube.js";

class Element extends EventTarget {
  dataset = {};
  children = [];
  contentWindow = {};
  clientWidth = 320;
  hidden = true;
  disabled = false;
  textContent = "";
  replaceChildren(...items) { this.children = items; for (const item of items) item.parent = this; }
  append(...items) { this.replaceChildren(...this.children, ...items); }
  remove() { this.parent?.replaceChildren(...this.parent.children.filter(item => item !== this)); }
  setAttribute() {}
  focus() {}
  click() { if (!this.hidden && !this.disabled) { this.dispatchEvent(new Event("click")); this.onclick?.(); } }
}
function fixture() {
  const nodes = new Map(), view = new EventTarget();
  const el = name => { if (!nodes.has(name)) nodes.set(name, new Element()); return nodes.get(name); };
  const timers = new Map();
  let id = 0;
  Object.assign(view, { setTimeout: fire => { timers.set(++id, fire); return id; }, clearTimeout: key => timers.delete(key) });
  const advance = () => { const tasks = [...timers.values()]; timers.clear(); for (const fire of tasks) fire(); };
  const doc = { querySelector: el, createElement: () => new Element(), defaultView: view };
  const message = (source, type, value, origin = "https://www.tiktok.com") =>
    view.dispatchEvent(Object.assign(new Event("message"), { source, origin, data: { "x-tiktok-player": true, type, value } }));
  return { el, advance, doc, message };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("Watch Desk distinguishes transport failure, approval and denied embeds", async () => {
  const { el, doc } = fixture();
  const player = el("[data-player]"), status = el("[data-player-status]"), action = el("[data-player-action]");
  const proxy = el("[data-proxy-action]"); proxy.hidden = false;
  player.querySelector = el;
  let checks = 0, proxyCount = 0;
  wireYouTubeDesk(doc, "https://www.youtube.com/shorts/jNQXAC9IVRw?t=2", [], {
    current: () => true, directAllowed: () => true, open() {},
    openProxy: () => proxyCount++,
    check: id => { assert.equal(id, "jNQXAC9IVRw"); return { state: ++checks === 1 ? "unavailable" : "ready" }; }
  });
  await tick();
  assert.match(status.textContent, /couldn’t verify/);
  assert.equal(action.textContent, "Retry eligibility check");
  assert.ok(!player.children.length);
  action.click();
  await tick();
  assert.equal(action.textContent, "Load YouTube player");
  assert.ok(!player.children.length);
  action.click();
  const [frame] = player.children;
  assert.equal(new URL(frame.src).searchParams.get("start"), "2");
  action.click();
  assert.equal(player.children[0], status);
  proxy.click(); proxy.click();
  assert.equal(proxyCount, 1);

  for (const allowed of [true, false]) {
    const other = fixture();
    other.el("[data-player]").querySelector = other.el;
    let called = false;
    wireYouTubeDesk(other.doc, "https://youtu.be/jNQXAC9IVRw", [], { current: () => true, directAllowed: () => allowed,
      open() {}, openProxy() {}, check() { called = true; return { state: "external" }; } });
    await tick();
    assert.equal(called, allowed);
    assert.equal(other.el("[data-player-action]").hidden, true);
    assert.match(other.el("[data-player-status]").textContent, allowed ? /doesn’t allow/ : /Direct playback is unavailable/);
  }
});

test("TikTok buffering can time out, retry, and recover without autoplay", () => {
  const { el, doc, advance, message } = fixture();
  const load = el("#loadPlayer"), stop = el("#closePlayer"), player = el("#player"), status = el("#playerStatus");
  const url = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
  let direct = true;
  mountTikTokPlayer(doc, url, { directAllowed: () => direct, openProxy() {} });
  assert.equal(player.children.length, 0);
  load.click();
  const [first] = player.children;
  assert.equal(new URL(first.src).searchParams.get("autoplay"), "0");
  message(first.contentWindow, "onStateChange", -1);
  assert.match(status.textContent, /initializing/);
  message(first.contentWindow, "onStateChange", 3);
  assert.match(status.textContent, /buffering/);
  message(first.contentWindow, "onPlayerReady");
  advance();
  assert.match(status.textContent, /longer than expected/);
  load.click();
  const [second] = player.children;
  message(first.contentWindow, "onStateChange", 1);
  message(second.contentWindow, "onStateChange", 1, "https://tiktok.com.example.test");
  assert.match(status.textContent, /Connecting/);
  message(second.contentWindow, "onStateChange", 2);
  assert.match(status.textContent, /paused/);
  stop.click();
  assert.equal(player.children.length, 0);
  load.click();
  direct = false;
  message(player.children[0].contentWindow, "onPlayerReady");
  assert.equal(player.children.length, 0);
  assert.equal(load.hidden, true);
  assert.match(status.textContent, /unavailable in this session/);
});
