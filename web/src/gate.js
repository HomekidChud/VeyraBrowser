/* Veyra Access Gate client.
   Runs before the app boots: if the service is gated and this device has not
   been unlocked (no invite-link session), the whole page is replaced with the
   Veyra waitlist screen. The gate token is stored locally and attached to
   every API request as the X-Veyra-Gate header. */
(() => {
  const GATE_KEY = "veyra-gate";
  const apiFromMeta = () => {
    try {
      // Mirror core.js: on a loopback page the ?veyra_api= hint overrides the
      // fixed deployment metadata, so local development can exercise the gate.
      const localPage = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
      let hinted = "";
      if (localPage) {
        try {
          const params = new URLSearchParams(location.search);
          const hintedRaw = params.get("veyra_api") || "";
          if (hintedRaw) {
            const u = new URL(hintedRaw);
            if (/^https?:$/.test(u.protocol) && !u.username && !u.password && !u.search && !u.hash && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) hinted = u.origin;
          }
        } catch {}
      }
      if (hinted) return hinted;
      const raw = document.querySelector('meta[name="veyra-api"]')?.content || "https://veyraserver-xscy.onrender.com";
      return new URL(raw).origin;
    } catch { return "https://veyraserver-xscy.onrender.com"; }
  };
  const API_ORIGIN = apiFromMeta();
  const token = () => { try { return localStorage.getItem(GATE_KEY) || ""; } catch { return ""; } };

  // Capture ?gate=<token> from an invite link or key unlock and clean the URL.
  try {
    const params = new URLSearchParams(location.search);
    const gateParam = params.get("gate");
    if (gateParam) {
      try { localStorage.setItem(GATE_KEY, gateParam); } catch {}
      params.delete("gate");
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    }
  } catch {}

  // Attach the gate token to every request that targets the Veyra API.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      let url = "";
      if (typeof input === "string" || input instanceof URL) url = String(input);
      else if (input?.url) url = String(input.url);
      if (url.startsWith(API_ORIGIN)) {
        const headers = new Headers(init.headers || {});
        const current = token();
        if (current && !headers.has("x-veyra-gate")) headers.set("x-veyra-gate", current);
        init = { ...init, headers, credentials: "omit" };
      }
    } catch {}
    return nativeFetch(input, init);
  };


  function gateStatus() {
    return nativeFetch(`${API_ORIGIN}/api/gate/status`, { headers: { "x-veyra-gate": token() }, credentials: "omit" })
      .then(r => r.json().catch(() => ({})))
      .catch(() => null);
  }

  function renderScreen() {
    document.documentElement.dataset.theme = "dark";
    document.head.querySelectorAll("link[rel=stylesheet]").forEach(l => l.remove());
    document.body.className = "";
    document.body.innerHTML = `
<main style="width:100%;max-width:460px">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:26px"><svg width="30" height="30" viewBox="0 0 32 32" fill="none"><path d="M7 8.5l9 16 9-16" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25" cy="8.5" r="2.4" fill="#5b8cff"/></svg><b style="font-size:20px;letter-spacing:.5px">Veyra</b></div>
<div style="background:#14171d;border:1px solid #232732;border-radius:14px;padding:26px">
<span style="display:inline-block;background:rgba(91,140,255,.12);color:#5b8cff;border:1px solid rgba(91,140,255,.35);font-size:12px;font-weight:600;padding:4px 10px;border-radius:99px;margin-bottom:14px">🔒 Invite only</span>
<h1 style="font-size:22px;margin:0 0 8px">Veyra is in early access</h1>
<p style="color:#9aa3b2;margin:0 0 18px">Access is by invitation. Join the waitlist and we will email you an access key when a spot opens, or enter your key if you already have one.</p>
<form id="veyra-join">
<label for="veyra-email" style="display:block;font-size:13px;color:#9aa3b2;margin:14px 0 6px">Email address</label>
<input id="veyra-email" type="email" placeholder="you@example.com" autocomplete="email" required style="width:100%;background:#0d0f13;border:1px solid #232732;border-radius:9px;color:#e8eaf0;padding:10px 12px;font:inherit;outline:none">
<button type="submit" id="veyra-join-btn" style="width:100%;margin-top:16px;background:#5b8cff;color:#fff;border:0;border-radius:9px;padding:11px;font:inherit;font-weight:600;cursor:pointer">Join the waitlist</button>
<div id="veyra-join-msg" style="margin-top:12px;font-size:13px;min-height:20px;color:#9aa3b2"></div>
</form>
<form id="veyra-unlock">
<label for="veyra-key" style="display:block;font-size:13px;color:#9aa3b2;margin:14px 0 6px">Access key</label>
<input id="veyra-key" type="text" placeholder="VY-…" autocomplete="off" style="width:100%;background:#0d0f13;border:1px solid #232732;border-radius:9px;color:#e8eaf0;padding:10px 12px;font:inherit;outline:none">
<button type="submit" id="veyra-unlock-btn" style="width:100%;margin-top:16px;background:#5b8cff;color:#fff;border:0;border-radius:9px;padding:11px;font:inherit;font-weight:600;cursor:pointer">Unlock Veyra</button>
<div id="veyra-unlock-msg" style="margin-top:12px;font-size:13px;min-height:20px;color:#9aa3b2"></div>
</form>
</div>
<div style="margin-top:18px;text-align:center;color:#5c6472;font-size:12px">Links to Veyra rotate constantly — only current invite links work.</div>
</main>`;
    document.body.style.cssText = "background:#0d0f13;color:#e8eaf0;font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;margin:0";
    document.title = "Veyra — Invite only";

    const post = (path, body) => nativeFetch(API_ORIGIN + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-veyra-gate": token() },
      credentials: "omit",
      body: JSON.stringify(body)
    }).then(r => r.json().then(j => ({ status: r.status, json: j })).catch(() => ({ status: r.status, json: {} })));

    document.getElementById("veyra-join").addEventListener("submit", e => {
      e.preventDefault();
      const email = document.getElementById("veyra-email").value.trim();
      const btn = document.getElementById("veyra-join-btn"), el = document.getElementById("veyra-join-msg");
      btn.disabled = true; el.textContent = "Joining…"; el.style.color = "#9aa3b2";
      post("/api/gate/waitlist", { email }).then(r => {
        if ((r.status === 201 || r.status === 200) && r.json?.ok) {
          el.textContent = "You're on the list — position #" + (r.json.entry?.position ?? "?") + ". We'll email your key when a spot opens."; el.style.color = "#57c993";
        } else {
          el.textContent = r.json?.error || "Could not join the waitlist."; el.style.color = "#e0656f";
        }
      }).catch(() => { el.textContent = "Could not reach Veyra. Try again."; el.style.color = "#e0656f"; })
        .finally(() => { btn.disabled = false; });
    });

    document.getElementById("veyra-unlock").addEventListener("submit", e => {
      e.preventDefault();
      const key = document.getElementById("veyra-key").value.trim();
      const btn = document.getElementById("veyra-unlock-btn"), el = document.getElementById("veyra-unlock-msg");
      btn.disabled = true; el.textContent = "Checking…"; el.style.color = "#9aa3b2";
      post("/api/gate/unlock", { key }).then(r => {
        if (r.status === 200 && r.json?.ok && r.json.token) {
          try { localStorage.setItem(GATE_KEY, r.json.token); } catch {}
          el.textContent = "Unlocked. Loading Veyra…"; el.style.color = "#57c993";
          location.replace(location.pathname + location.hash);
          return;
        }
        el.textContent = r.json?.error || "That key is not valid."; el.style.color = "#e0656f";
      }).catch(() => { el.textContent = "Could not reach Veyra. Try again."; el.style.color = "#e0656f"; })
        .finally(() => { btn.disabled = false; });
    });
  }

  // Gate the whole app: expose a promise the bootstrap can await before booting.
  window.veyraGateCheck = async () => {
    try {
      const status = await gateStatus();
      if (!status) return true;               // API unreachable -> let the app handle errors.
      if (!status.gated || status.unlocked) return true;
      renderScreen();
      return false;
    } catch { return true; }
  };
})();
