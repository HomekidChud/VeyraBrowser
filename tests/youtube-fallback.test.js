import assert from "node:assert/strict";
import { isYouTubeUrl, normalizeYouTubeUrl, youtubeEmbedUrl, youtubeFallbackHtml, youtubeSignInUrl } from "../web/src/youtube.js";

const origin = "https://homekidchud.github.io";
const videoUrl = "https://www.youtube.com/watch?v=42TV0hS59OA&t=45";

assert.equal(isYouTubeUrl("https://m.youtube.com/"), true);
assert.equal(isYouTubeUrl("https://youtu.be/42TV0hS59OA"), true);
assert.equal(isYouTubeUrl("https://youtube.com.evil.example/watch?v=42TV0hS59OA"), false);
assert.equal(isYouTubeUrl("javascript://youtube.com/watch?v=42TV0hS59OA"), false);
assert.equal(normalizeYouTubeUrl("https://m.youtube.com/"), "https://www.youtube.com/");
assert.equal(normalizeYouTubeUrl("https://m.youtube.com/watch?v=42TV0hS59OA&t=45"), videoUrl);
assert.equal(normalizeYouTubeUrl("https://www.youtube.com/watch?v=42TV0hS59OA"), "https://www.youtube.com/watch?v=42TV0hS59OA");

const embed = youtubeEmbedUrl(videoUrl, origin);
assert.ok(embed, "watch URLs should produce an embed URL");
const embedParsed = new URL(embed);
assert.equal(embedParsed.hostname, "www.youtube-nocookie.com");
assert.equal(embedParsed.pathname, "/embed/42TV0hS59OA");
assert.equal(embedParsed.searchParams.get("start"), "45");
assert.equal(embedParsed.searchParams.get("origin"), origin);
assert.equal(embedParsed.searchParams.get("widget_referrer"), origin);
assert.equal(youtubeEmbedUrl("https://m.youtube.com/", origin), null, "home URLs should use the normal Veyra proxy");
assert.equal(youtubeEmbedUrl("https://www.youtube.com/watch?v=bad!", origin), null, "invalid video IDs must be rejected");
assert.equal(youtubeEmbedUrl("https://youtube.com.evil.example/watch?v=42TV0hS59OA", origin), null);

const watchHtml = youtubeFallbackHtml(videoUrl, origin);
assert.match(watchHtml, /youtube-nocookie\.com\/embed\/42TV0hS59OA/);
assert.match(watchHtml, /referrerpolicy="strict-origin-when-cross-origin"/);
assert.match(watchHtml, /Official YouTube player/);
assert.match(watchHtml, /Sign in to YouTube/);
assert.match(watchHtml, /parent\.postMessage\(\{type:newTab\?"veyra:open":"veyra:navigate"/);
assert.match(watchHtml, /Google handles sign-in; Veyra does not receive or store your Google credentials/);
assert.match(watchHtml, /target="_blank"/);

assert.equal(youtubeFallbackHtml("https://www.youtube.com/", origin), "", "the YouTube home page must not be replaced by an external-link fallback");
assert.equal(youtubeFallbackHtml("https://m.youtube.com/", origin), "", "the mobile homepage must be redirected and loaded normally");

const signIn = new URL(youtubeSignInUrl(videoUrl));
assert.equal(signIn.origin, "https://accounts.google.com");
assert.equal(signIn.pathname, "/ServiceLogin");
assert.equal(signIn.searchParams.get("service"), "youtube");
assert.equal(signIn.searchParams.get("continue"), new URL(videoUrl).href);
const mobileSignIn = new URL(youtubeSignInUrl("https://m.youtube.com/watch?v=42TV0hS59OA"));
assert.equal(mobileSignIn.searchParams.get("continue"), "https://www.youtube.com/watch?v=42TV0hS59OA");
assert.equal(youtubeSignInUrl("https://example.com/"), null);

console.log("VeyraBrowser YouTube routing checks passed");
