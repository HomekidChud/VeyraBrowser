import assert from "node:assert/strict";
import { settingsPins, settingSearchTerms, settingTextMatches } from "../web/src/settings-model.js";
import { appearanceValues, readSetup, setupForExport } from "../web/src/studio-model.js";
import { nowGameMarkup, nowGameUrl } from "../web/src/game-launch.js";

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

console.log("Settings Deck, safe appearance export, and direct game launch checks passed.");
