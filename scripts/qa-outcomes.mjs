export function classifyOutcome(content, status) {
  if (status >= 400) return "http-error";
  const text = String(content || "").trim();
  if (/verify you are human|requires its own security verification|access denied|blocked by network security|not a robot/i.test(text) ||
      (text.length < 800 && /captcha|robot or human/i.test(text))) return "site-challenge";
  if (/browser.*unavailable|session.*expired|could not be displayed|server.*error/i.test(text)) return "veyra-error";
  if (/something went wrong|sorry about that|temporarily unavailable|an error occurred/i.test(text) ||
      (text.length < 100 && /^(?:unknown error|error)\b/i.test(text))) return "provider-error-ui";
  return text.length >= 50 ? "content-rendered" : "empty-or-visual-only";
}
