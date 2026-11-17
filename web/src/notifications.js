const activeKeys = new Map();
let notificationId = 0;

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = String(text);
  return el;
}

export function toast(message, {
  kind = "", title = "", action = null, actionLabel = "", ms = 3200,
  node = null, actions = [], field = null, key = ""
} = {}) {
  const host = document.getElementById("toasts");
  if (!host) return;
  if (key && activeKeys.has(key)) return activeKeys.get(key);

  const focusBefore = document.activeElement;
  const id = `notice-${++notificationId}`;
  const card = element("section", `toast${["err", "warn", "success"].includes(kind) ? ` ${kind}` : ""}`);
  const content = element("div", "toast-content");
  const mark = element("span", "toast-mark", kind === "success" ? "✓" : kind === "err" || kind === "warn" ? "!" : "i");
  mark.setAttribute("aria-hidden", "true");
  const copy = element("div", "toast-copy");
  copy.id = id;
  copy.setAttribute("role", kind === "err" ? "alert" : "status");
  if (title) copy.append(element("div", "toast-title", title));
  if (message) copy.append(element("div", "toast-message", message));
  card.setAttribute("aria-labelledby", id);
  content.append(copy);
  if (node) content.append(node); // App-owned DOM only, never third-party HTML.
  const close = element("button", "toast-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", title ? `Dismiss ${title}` : "Dismiss notification");
  card.append(mark, content, close);

  let timer = 0, deadline = 0, remaining = Number(ms) > 0 ? Math.max(1200, Number(ms)) : 0;
  let closed = false, hovered = false, focused = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    if (key && activeKeys.get(key) === dismiss) activeKeys.delete(key);
    const hadFocus = card.contains(document.activeElement);
    card.inert = true;
    if (hadFocus && focusBefore?.isConnected && focusBefore !== document.body && document.activeElement === document.body) {
      focusBefore.focus({ preventScroll: true });
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.body.classList.contains("reduce-motion")) {
      card.remove();
    } else {
      card.classList.add("toast-exit");
      const cleanup = setTimeout(() => card.remove(), 220);
      card.addEventListener("animationend", e => {
        if (e.target === card && e.animationName === "notice-out") { clearTimeout(cleanup); card.remove(); }
      });
    }
  };
  const pause = () => { if (timer) { clearTimeout(timer); timer = 0; remaining = Math.max(1, deadline - Date.now()); } };
  const resume = () => {
    if (closed || !remaining || timer || hovered || focused) return;
    deadline = Date.now() + remaining;
    timer = setTimeout(dismiss, remaining);
  };
  close.addEventListener("click", dismiss);
  card.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); dismiss(); }
  });
  card.addEventListener("pointerenter", () => { hovered = true; pause(); });
  card.addEventListener("pointerleave", () => { hovered = false; resume(); });
  card.addEventListener("focusin", () => { focused = true; pause(); });
  card.addEventListener("focusout", e => { if (!card.contains(e.relatedTarget)) { focused = false; resume(); } });

  const entries = [...actions];
  if (typeof action === "function" && actionLabel) entries.push({ label: actionLabel, onClick: action });
  if (entries.length) {
    const row = element("div", "toast-actions");
    for (const entry of entries) {
      let control;
      if (entry.href) {
        let href;
        try { href = new URL(entry.href, location.href); } catch { continue; }
        if (!["https:", "http:"].includes(href.protocol) || href.username || href.password) continue;
        control = element("a", "toast-action", entry.label);
        control.href = href.href;
        if (entry.download && href.origin === location.origin) control.download = entry.download;
        else { control.target = "_blank"; control.rel = "noopener noreferrer"; }
      } else if (typeof entry.onClick === "function") {
        control = element("button", "toast-action", entry.label);
        control.type = "button";
        control.addEventListener("click", () => {
          if (entry.dismiss !== false) dismiss();
          try { entry.onClick(); } catch { /* Preserve legacy toast callbacks. */ }
        });
      }
      if (control) {
        if (entry.primary) control.classList.add("toast-action-primary");
        row.append(control);
      }
    }
    content.append(row);
  }

  let fieldInput = null;
  if (field && typeof field.onSubmit === "function") {
    const form = element("form", "toast-form");
    const label = element("label", "toast-label", field.label || "Text");
    const input = fieldInput = element("input", "toast-input");
    input.id = `${id}-input`;
    label.htmlFor = input.id;
    input.type = "text";
    input.required = true;
    input.maxLength = 100;
    input.value = String(field.value || "").slice(0, 100);
    input.placeholder = String(field.placeholder || "");
    form.append(label, input, element("button", "toast-action toast-action-primary", field.submitLabel || "Save"));
    form.addEventListener("submit", e => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) { input.setCustomValidity("Enter a value."); input.reportValidity(); return; }
      field.onSubmit(value);
      dismiss();
    });
    input.addEventListener("input", () => input.setCustomValidity(""));
    content.append(form);
  }

  host.append(card);
  if (key) activeKeys.set(key, dismiss);
  if (field?.autofocus) fieldInput?.focus({ preventScroll: true });
  resume();
  return dismiss;
}
