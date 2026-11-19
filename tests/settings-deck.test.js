import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { settingsPins, settingSearchTerms, settingTextMatches } from "../web/src/settings-model.js";
import { appearanceValues, readSetup, setupForExport } from "../web/src/studio-model.js";
import { nowGameMarkup, nowGameUrl } from "../web/src/game-launch.js";
import { GUIDES } from "../web/src/settings-guides.js";

assert.deepEqual(settingsPins(undefined, ["appearance", "performance", "shortcuts"]), ["appearance", "performance", "shortcuts"]);
assert.deepEqual(settingsPins([], ["appearance"]), []);
assert.deepEqual(settingsPins(["admin", "performance", "bad", "performance", "appearance"], ["appearance", "performance"]), ["performance", "appearance"]);
const terms = settingSearchTerms("  WALLPAPER   Fit wallpaper  ");
assert.deepEqual(terms, ["wallpaper", "fit"]);
assert.equal(settingTextMatches("adjust the fit of your wallpaper", terms), true);
assert.equal(settingTextMatches("wallpaper intensity", terms), false);
assert.equal(settingTextMatches("fits your windows", terms), false);

const appearance = appearanceValues({ settingsLayout: "list", settingsDensity: "roomy", settingsSurface: "contrast",
  chromeEdge: false, chromeTintStrength: 43 });
assert.deepEqual(readSetup(JSON.stringify(setupForExport("Deck", appearance))).appearance, appearance);
assert.equal(appearanceValues({ chromeTintStrength: 999 }).chromeTintStrength, 60);
assert.equal(appearanceValues({ settingsLayout: "invalid" }).settingsLayout, "cards");

const game = "https://now.gg/apps/valvolex/52100/rally-racer-dirt.html?x=1&y=2";
assert.equal(nowGameUrl(game), game);
for (const url of ["https://bloxity.io/games", "https://now.gg.fake.test/", "https://fake.test/?now.gg",
  "https://fake.test@now.gg/", "https://now.gg:444/", "javascript:now.gg", "http://now.gg/"]) assert.equal(nowGameUrl(url), null);
const page = nowGameMarkup(game);
assert.match(page, /x=1&amp;y=2/);
assert.match(page, /target="_blank" rel="noopener noreferrer"/);
assert.doesNotMatch(page, /<iframe|<script/i);

assert.equal(new Set(GUIDES.map(guide => guide.id)).size, 3);
const guideBytes = GUIDES.reduce((size, guide) => {
  const path = new URL(`../web/assets/guides/${guide.id}`, import.meta.url);
  const video = readFileSync(new URL(`${path.href}.mp4`));
  const poster = readFileSync(new URL(`${path.href}.jpg`));
  assert.equal(video.toString("ascii", 4, 8), "ftyp");
  assert.ok(video.indexOf("moov") > 0 && video.indexOf("moov") < video.indexOf("mdat"), "MP4 metadata comes before video data");
  assert.equal(poster.readUInt16BE(), 0xffd8);
  assert.ok(guide.steps.length > 0);
  return size + video.length + poster.length;
}, 0);
assert.ok(guideBytes < 1_500_000, "Settings tutorial bundle stays lightweight");

console.log("Settings Deck, appearance export, guide media, and direct game launch checks passed.");
