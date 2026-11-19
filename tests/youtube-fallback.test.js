import assert from "node:assert/strict";
import { isYouTubeUrl, normalizeYouTubeUrl, youtubeDeskVideo, youtubeEmbedUrl, youtubeFallbackHtml, youtubeSignInUrl } from "../web/src/youtube.js";

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
assert.equal(youtubeEmbedUrl("https://m.youtube.com/", origin), null, "home URLs are not video embeds and should be routed to the browser engine");
assert.equal(youtubeEmbedUrl("https://www.youtube.com/watch?v=bad!", origin), null, "invalid video IDs must be rejected");
assert.equal(youtubeEmbedUrl("https://youtube.com.evil.example/watch?v=42TV0hS59OA", origin), null);
assert.equal(youtubeEmbedUrl("https://www.youtube.com/watch?v=abc123", origin), null);
assert.equal(new URL(youtubeEmbedUrl("https://youtu.be/42TV0hS59OA?t=1h2m3s", origin)).searchParams.get("start"), "3723");
assert.equal(new URL(youtubeEmbedUrl("https://www.youtube.com/shorts/42TV0hS59OA#t=14s", origin)).searchParams.get("start"), "14");
assert.equal(new URL(youtubeEmbedUrl("https://www.youtube.com/live/42TV0hS59OA?list=PLExample&index=3", origin)).searchParams.get("index"), "3");

const watchHtml = youtubeFallbackHtml(videoUrl);
assert.doesNotMatch(watchHtml, /<iframe|youtube-nocookie\.com/, "no embed before eligibility verification");
assert.match(watchHtml, /YouTube Watch Desk/);
assert.match(watchHtml, /Watch queue/);
assert.match(watchHtml, /Open on YouTube/);
assert.match(watchHtml, /Checking whether this video can play here/);
assert.match(watchHtml, /<html lang="en" data-veyra-youtube-fallback="true">/);
assert.doesNotMatch(watchHtml, /<script\b/i, "the local player needs no injected script");
assert.match(watchHtml, /target="_blank" rel="noopener noreferrer"/);
assert.match(watchHtml, /min-height:200px/, "the player reserves room for YouTube's minimum player height");
assert.match(watchHtml, /@media\(max-width:760px\)/, "the queue stacks below the player in narrow panes");
const desk = youtubeDeskVideo(videoUrl + "&list=PLExample&index=3&unused=private");
assert.equal(desk.id, "42TV0hS59OA");
assert.equal(desk.url, videoUrl);
assert.equal(new URL(desk.embed).searchParams.has("list"), false, "unchecked playlist entries cannot autoplay from this embed");
assert.equal(new URL(desk.embed).searchParams.get("start"), "45");
assert.equal(youtubeDeskVideo("https://user:pass@www.youtube.com/watch?v=42TV0hS59OA"), null);
assert.equal(youtubeDeskVideo("https://www.youtube.com:444/watch?v=42TV0hS59OA"), null);

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
