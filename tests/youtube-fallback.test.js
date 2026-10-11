import assert from "node:assert/strict";
import { isYouTubeUrl, youtubeEmbedUrl, youtubeFallbackHtml, youtubeSignInUrl } from "../web/src/youtube.js";

const origin = "https://homekidchud.github.io";
const videoUrl = "https://www.youtube.com/watch?v=42TV0hS59OA&t=45";

assert.equal(isYouTubeUrl("https://m.youtube.com/"), true);
assert.equal(isYouTubeUrl("https://youtu.be/42TV0hS59OA"), true);
assert.equal(isYouTubeUrl("https://youtube.com.evil.example/watch?v=42TV0hS59OA"), false);
assert.equal(isYouTubeUrl("javascript://youtube.com/watch?v=42TV0hS59OA"), false);

const embed = youtubeEmbedUrl(videoUrl, origin);
assert.ok(embed, "watch URLs should produce an embed URL");
const embedParsed = new URL(embed);
assert.equal(embedParsed.hostname, "www.youtube-nocookie.com");
assert.equal(embedParsed.pathname, "/embed/42TV0hS59OA");
assert.equal(embedParsed.searchParams.get("start"), "45");
assert.equal(embedParsed.searchParams.get("origin"), origin);
assert.equal(embedParsed.searchParams.get("widget_referrer"), origin);
assert.equal(youtubeEmbedUrl("https://m.youtube.com/", origin), null, "the homepage has no video ID to embed");
assert.equal(youtubeEmbedUrl("https://www.youtube.com/watch?v=bad!", origin), null, "invalid video IDs must be rejected");
assert.equal(youtubeEmbedUrl("https://youtube.com.evil.example/watch?v=42TV0hS59OA", origin), null);

const watchHtml = youtubeFallbackHtml(videoUrl, origin);
assert.match(watchHtml, /youtube-nocookie\.com\/embed\/42TV0hS59OA/);
assert.match(watchHtml, /referrerpolicy="strict-origin-when-cross-origin"/);
assert.match(watchHtml, /Watch on YouTube/);
assert.match(watchHtml, /Sign in to YouTube/);
assert.match(watchHtml, /Veyra does not receive or store your Google credentials/);
assert.doesNotMatch(watchHtml, /<script\b/i, "the fallback document must not inject scripts");

const homeHtml = youtubeFallbackHtml("https://m.youtube.com/", origin);
assert.doesNotMatch(homeHtml, /<iframe\b/i, "the YouTube home feed cannot be embedded");
assert.match(homeHtml, /Open YouTube in a new tab/);
assert.match(homeHtml, /interactive home feed cannot run inside Veyra’s Fast Proxy/);

const signIn = new URL(youtubeSignInUrl(videoUrl));
assert.equal(signIn.origin, "https://accounts.google.com");
assert.equal(signIn.pathname, "/ServiceLogin");
assert.equal(signIn.searchParams.get("service"), "youtube");
assert.equal(signIn.searchParams.get("continue"), new URL(videoUrl).href);
assert.equal(youtubeSignInUrl("https://example.com/"), null);

console.log("VeyraBrowser YouTube fallback checks passed");
