import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTikTokHome, publicTikTokPost, tiktokTarget } from "../web/src/tiktok.js";

test("canonicalises only the HTTPS TikTok homepage", () => {
  assert.equal(normalizeTikTokHome("https://tiktok.com/"), "https://www.tiktok.com/");
  for (const input of ["https://tiktok.com/@artist", "https://vm.tiktok.com/code/", "https://tiktok.com.example/", "http://tiktok.com/"]) {
    assert.equal(normalizeTikTokHome(input), input);
  }
});
test("recognises supported TikTok posts without passing through query or fragment", () => {
  for (const type of ["video", "photo"]) {
    assert.deepEqual(publicTikTokPost(`https://tiktok.com/@sample/${type}/6718335390845095173/?ref=test#share`), {
      url: `https://www.tiktok.com/@sample/${type}/6718335390845095173`,
      player: "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0"
    });
  }
});

test("does not intercept profiles, short links, non-TikTok or unexpected post URLs", () => {
  for (const url of [
    "https://www.tiktok.com/@sample", "https://vm.tiktok.com/ZXY/",
    "https://www.tiktok.com.example.test/@sample/video/6718335390845095173",
    "https://example.test/@sample/video/6718335390845095173",
    "http://www.tiktok.com/@sample/video/6718335390845095173",
    "https://www.tiktok.com:8443/@sample/video/6718335390845095173",
    "https://user:pass@www.tiktok.com/@sample/video/6718335390845095173",
    "https://www.tiktok.com/@sample/video/not-a-post",
    "https://www.tiktok.com/player/v1/6718335390845095173"
  ]) assert.equal(publicTikTokPost(url), null, url);
});

test("recognises official mobile post URLs and short links without turning them into arbitrary embeds", () => {
  assert.deepEqual(publicTikTokPost("https://m.tiktok.com/@sample/photo/6718335390845095173"), {
    url: "https://www.tiktok.com/@sample/photo/6718335390845095173",
    player: "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0"
  });
  for (const url of ["https://vm.tiktok.com/ZXY/", "https://vt.tiktok.com/ZXy42", "https://www.tiktok.com/t/ZXy42/"]) {
    assert.deepEqual(tiktokTarget(`${url}?ref=test#ignored`), { url, player: "", kind: "share" });
  }
  for (const url of ["https://vm.tiktok.com.example.test/ZXy42", "https://user@vm.tiktok.com/ZXy42",
    "https://vt.tiktok.com/%2FZXy42", "https://vm.tiktok.com:9443/ZXy42"]) assert.equal(tiktokTarget(url), null, url);
});

test("routes TikTok site and creator URLs without turning arbitrary paths into embeds", () => {
  assert.deepEqual(tiktokTarget("https://m.tiktok.com/@scout2015/?ref=test"), {
    url: "https://www.tiktok.com/@scout2015", player: "", kind: "profile", handle: "scout2015"
  });
  const home = tiktokTarget("https://tiktok.com/");
  assert.deepEqual(home, { url: "https://www.tiktok.com/", player: "", kind: "site" });
  for (const url of ["https://www.tiktok.com/search?q=dog%20tricks", "https://www.tiktok.com/login",
    "https://www.tiktok.com/@sample/live", "https://www.tiktok.com/t/ZXy42/extra",
    "https://www.tiktok.com/@sample%2Fvideo", "https://www.tiktok.com/player/v1/123"]) {
    assert.deepEqual(tiktokTarget(url), { url, player: "", kind: "site" });
  }
  for (const url of ["https://www.tiktok.com.example.test/", "https://login.tiktok.com/", "http://www.tiktok.com/",
    "https://user@www.tiktok.com/", "https://www.tiktok.com:9443/", "https://vm.tiktok.com/bad/path"]) {
    assert.equal(tiktokTarget(url), null);
  }
});
