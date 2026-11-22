import assert from "node:assert/strict";
import { test } from "node:test";
import { publicTikTokPost, tiktokTarget } from "../web/src/tiktok.js";

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
    assert.deepEqual(tiktokTarget(`${url}?ref=test#ignored`), { url, player: "" });
  }
  for (const url of ["https://www.tiktok.com/@sample", "https://www.tiktok.com/t/ZXy42/extra",
    "https://vm.tiktok.com.example.test/ZXy42", "https://user@vm.tiktok.com/ZXy42",
    "https://vt.tiktok.com/%2FZXy42", "https://vm.tiktok.com:9443/ZXy42"]) assert.equal(tiktokTarget(url), null, url);
});
