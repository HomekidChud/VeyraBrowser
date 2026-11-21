import assert from "node:assert/strict";
import { test } from "node:test";
import { publicTikTokPost } from "../web/src/tiktok.js";

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
