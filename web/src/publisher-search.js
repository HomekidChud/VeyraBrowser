const DOMAINS = new Set(["pornhub.com", "xvideos.com"]);
const BASE = "/api/search/publisher";
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const MAX_AGE_MS = 600_000;

export function publisherScope(value, category) {
  if (!["web", "videos"].includes(category) || typeof value !== "string") return null;
  const match = /^search:\s*(?:www\.)?([a-z0-9.-]+)(?:\s+(.+))?$/i.exec(value.trim());
  const domain = match?.[1].toLowerCase(), words = match?.[2] || "";
  if (!DOMAINS.has(domain) || /(?:^|\s)-?site:/i.test(words)) return null;
  const q = `search:${domain}${words ? ` ${words}` : ""}`;
  return q.length <= 240 ? { domain, q } : null;
}

export function publisherLaunch(grant) {
  const { nonce, verificationUrl, expiresInSeconds } = grant || {};
  if (typeof nonce !== "string" || !NONCE.test(nonce) ||
      !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds * 1000 > MAX_AGE_MS) return null;
  try {
    const url = new URL(verificationUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
        url.searchParams.size !== 1 || url.searchParams.get("nonce") !== nonce) return null;
    return { url, nonce, ttl: expiresInSeconds * 1000 };
  } catch { return null; }
}

export function publisherPage(data, domain, page) {
  if (data?.ok !== true || data.domain !== domain || data.page !== page ||
      !Number.isSafeInteger(data.total) || data.total < 0 || data.total > 15_000 ||
      !Number.isSafeInteger(data.expiresInMs) || data.expiresInMs <= 0 || data.expiresInMs > MAX_AGE_MS ||
      !Array.isArray(data.results) || data.results.length > 24) return null;
  const rows = [];
  for (const row of data.results) {
    if (row?.source !== domain || row.type !== "videos" || typeof row.title !== "string" ||
        !row.title.trim() || row.title.length > 240) continue;
    try {
      const url = new URL(row.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
          ![domain, `www.${domain}`].includes(url.hostname)) continue;
      rows.push({ title: row.title, url: url.href });
    } catch {}
  }
  return { rows, total: data.total, ttl: data.expiresInMs,
    next: data.nextPage === page + 1 && (page + 1) * 24 < data.total ? page + 1 : null };
}

export function createPublisherSearch({ panel, request }) {
  let state = null;
  const el = (tag, text, classname) => Object.assign(document.createElement(tag), { textContent: text, className: classname || "" });
  const button = (label, action) => Object.assign(el("button", label, "btn ghost"), { type: "button", onclick: action });
  const live = s => state === s && s.current() && !s.controller.signal.aborted;
  const call = (s, suffix = "", json) => request(`${BASE}${suffix}${suffix.includes("?") ? "&" : "?"}privacy=restricted`,
    { json, signal: s.controller.signal, timeoutMs: 10000 });
  function closePopup(s) {
    clearInterval(s.popupTimer);
    if (s.popup && !s.popup.closed) s.popup.close();
    s.popup = null;
  }
  function clear() {
    if (state) {
      closePopup(state); clearTimeout(state.expiryTimer); state.controller.abort();
      state.nonce = ""; state.rows = [];
    }
    state = null;
    panel.hidden = true;
    panel.replaceChildren();
  }
  function paint(s) {
    if (!live(s)) return;
    const focus = panel.contains(document.activeElement);
    const title = el("h2", "Publisher catalog");
    const note = el("p", s.message || (s.unlocked
      ? `${s.rows.length.toLocaleString()} of ${s.total.toLocaleString()} verified catalog results. Links open on the publisher’s site.`
      : "Verify your age before opening this catalog."));
    note.setAttribute("role", "status");
    const entries = [title, note];
    if (s.unlocked) {
      const list = el("ul", "", "search-publisher-list");
      for (const row of s.rows) {
        const item = el("li", "");
        item.append(Object.assign(el("a", row.title), { href: row.url, target: "_blank", rel: "noopener noreferrer" }));
        list.append(item);
      }
      if (s.rows.length) entries.push(list);
      if (s.next !== null && !s.busy) entries.push(button("More publisher results", () => void load(s, s.next)));
      entries.push(button("Close publisher results", () => lock(s, "")));
    } else if (!s.busy) {
      entries.push(button("Verify age", () => void begin(s)));
    } else if (s.popup) {
      entries.push(button("Cancel", () => lock(s, "Age verification cancelled.")));
    }
    panel.replaceChildren(...entries);
    panel.hidden = false;
    if (focus) panel.querySelector("button")?.focus({ preventScroll: true });
  }
  function lock(s, message) {
    if (!live(s)) return;
    closePopup(s);
    clearTimeout(s.expiryTimer);
    s.controller.abort(); // Discard pending responses, including result pages.
    Object.assign(s, { controller: new AbortController(), nonce: "", origin: "", deadline: 0, unlocked: false,
      busy: false, rows: [], total: 0, next: null, message });
    paint(s);
  }
  function expire(s, deadline) {
    s.deadline = deadline;
    clearTimeout(s.expiryTimer);
    s.expiryTimer = setTimeout(() => lock(s, "Age verification expired. Verify again to view publisher results."), Math.max(0, deadline - Date.now()));
  }
  async function begin(s) {
    if (!live(s) || s.busy) return;
    const popup = window.open("about:blank", "_blank", "popup,width=480,height=680");
    if (!popup) { s.message = "Allow the verification popup, then try again."; paint(s); return; }
    popup.document.body.textContent = "Starting Veyra age verification…";
    s.popup = popup; s.busy = true; s.message = "Waiting for age verification…"; paint(s);
    const signal = s.controller.signal, started = Date.now();
    try {
      const launch = publisherLaunch(await call(s, "/challenge", {}));
      if (!live(s) || signal.aborted) return;
      if (!launch || popup.closed || started + launch.ttl <= Date.now()) throw new Error();
      s.origin = launch.url.origin; s.nonce = launch.nonce;
      expire(s, started + launch.ttl);
      // Keep the query out of the Referer and preserve the trusted popup identity.
      const link = popup.document.createElement("a");
      link.href = launch.url.href; link.referrerPolicy = "no-referrer";
      popup.document.body.append(link); link.click();
      s.popupTimer = setInterval(() => {
        if (popup.closed) lock(s, "The verification window closed. Try again to continue.");
      }, 500);
    } catch {
      if (!signal.aborted) lock(s, "Age verification could not start. Try again.");
    }
  }
  async function load(s, page) {
    if (!live(s) || !s.nonce) return;
    s.busy = true; s.message = "Loading verified publisher results…"; paint(s);
    const signal = s.controller.signal, started = Date.now();
    try {
      const data = publisherPage(await call(s, "", { nonce: s.nonce, q: s.query, page }), s.domain, page);
      if (!live(s) || signal.aborted) return;
      const deadline = Math.min(s.deadline, started + (data?.ttl || 0));
      if (!data || deadline <= Date.now()) throw new Error();
      s.rows = [...new Map([...s.rows, ...data.rows].map(row => [row.url, row])).values()];
      Object.assign(s, { unlocked: true, busy: false, message: "", total: data.total, next: data.next });
      expire(s, deadline); paint(s);
    } catch {
      if (!signal.aborted) lock(s, "Publisher results are unavailable. Verify again to retry.");
    }
  }
  async function onDecision(event) {
    const s = state, data = event.data;
    if (!s || !live(s) || !s.popup || event.source !== s.popup || event.origin !== s.origin ||
        !s.nonce || s.deadline <= Date.now() || data?.type !== "veyra:publisher-age-decision" ||
        data.nonce !== s.nonce || typeof data.assertion !== "string" ||
        data.assertion.length > 2048 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(data.assertion)) return;
    closePopup(s);
    const signal = s.controller.signal;
    try {
      const result = await call(s, "/verify", { assertion: data.assertion });
      if (!live(s) || signal.aborted) return;
      if (result?.ok !== true) throw new Error();
      await load(s, 0);
    } catch {
      if (!signal.aborted) lock(s, "Age verification did not unlock publisher results.");
    }
  }
  window.addEventListener("message", onDecision);
  window.addEventListener("pagehide", clear);
  document.addEventListener("visibilitychange", () => {
    if (state?.deadline && state.deadline <= Date.now()) lock(state, "Age verification expired. Verify again to view publisher results.");
  });
  return { clear, show({ tab, rawQuery, category, token, current }) {
    const scope = token && publisherScope(rawQuery, category);
    if (!scope) { if (state) clear(); return; }
    if (state?.tab === tab && state.rawQuery === rawQuery && state.category === category && state.token === token) return;
    clear();
    const s = state = { tab, rawQuery, category, token, current, domain: scope.domain, query: scope.q,
      controller: new AbortController(), rows: [], next: null };
    void call(s, `/status?${new URLSearchParams({ domain: s.domain })}`)
      .then(available => { if (live(s) && available?.ok === true) paint(s); }).catch(() => {});
  } };
}
