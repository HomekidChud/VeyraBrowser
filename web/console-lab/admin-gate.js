(() => {
  "use strict";

  const TRUSTED_VEYRA_ORIGIN = "https://homekidchud.github.io";
  const API_ORIGIN = (document.querySelector('meta[name="veyra-api"]')?.content || "https://veyraserver-xscy.onrender.com").replace(/\/$/, "");
  const $ = id => document.getElementById(id);
  const gate = $("accessGate");
  const lab = $("lab");
  const accessState = $("accessState");
  const retry = $("retryAccess");

  function deny(reason) {
    lab.hidden = true;
    gate.hidden = false;
    accessState.textContent = reason || "Sign in to Veyra with an administrator account to use this page.";
    retry.hidden = false;
    retry.onclick = () => location.reload();
  }

  async function verifyDirectSession() {
    if (location.origin !== TRUSTED_VEYRA_ORIGIN) {
      return { allowed: false, reason: "Open the official Veyra Console Lab in the same browser profile where you signed in as an administrator." };
    }

    let session = null;
    let settings = {};
    try {
      session = JSON.parse(localStorage.getItem("veyra-auth") || "null");
      settings = JSON.parse(localStorage.getItem("veyra-settings") || "{}");
    } catch {}

    const headers = new Headers();
    if (typeof session?.token === "string" && session.token) headers.set("Authorization", `Bearer ${session.token}`);
    if (typeof settings?.adminToken === "string" && settings.adminToken.trim()) headers.set("X-Veyra-Admin-Token", settings.adminToken.trim());
    if (!headers.has("Authorization") && !headers.has("X-Veyra-Admin-Token")) {
      return { allowed: false, reason: "No Veyra administrator session was found. Sign in, then open Console Lab from Veyra’s menu." };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${API_ORIGIN}/api/auth/config`, {
        method: "GET",
        headers,
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal
      });
      const config = await response.json().catch(() => null);
      if (!response.ok) return { allowed: false, reason: "VeyraServer could not verify this session. Sign in again and retry." };
      return config?.admin === true
        ? { allowed: true }
        : { allowed: false, reason: "This Veyra account is not an administrator. Sign in with an admin account, then open Console Lab from Veyra’s menu." };
    } catch {
      return { allowed: false, reason: "Could not verify administrator access with VeyraServer. Check your connection and retry from Veyra’s menu." };
    } finally {
      clearTimeout(timeout);
    }
  }

  function verifyThroughVeyra() {
    if (window.parent === window) return Promise.resolve({ allowed: false, reason: "Open Console Lab from Veyra’s administrator menu." });
    const requestId = `console-lab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise(resolve => {
      let settled = false;
      let timer;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(result);
      };
      const onMessage = event => {
        const data = event.data;
        if (event.source !== window.parent || event.origin !== TRUSTED_VEYRA_ORIGIN || data?.type !== "veyra:console-lab:auth-result" || data.requestId !== requestId) return;
        finish({ allowed: data.allowed === true, reason: String(data.reason || "Sign in to Veyra with an administrator account to use the Console Lab.") });
      };
      window.addEventListener("message", onMessage);
      timer = setTimeout(() => finish({ allowed: false, reason: "Veyra did not confirm administrator access. Reopen this page from the menu in Veyra’s Fast proxy." }), 8000);
      try {
        window.parent.postMessage({ type: "veyra:console-lab:auth-check", requestId }, TRUSTED_VEYRA_ORIGIN);
      } catch {
        finish({ allowed: false, reason: "Could not ask Veyra to verify administrator access. Reopen Console Lab from Veyra’s menu." });
      }
    });
  }

  function loadRunner() {
    document.body.dataset.consoleLabAccess = "granted";
    gate.hidden = true;
    lab.hidden = false;
    const script = document.createElement("script");
    script.src = "runner.js?v=5";
    script.defer = true;
    script.onerror = () => deny("Administrator access was verified, but the lab runner did not load. Reload and try again.");
    document.head.appendChild(script);
  }

  async function start() {
    const proxiedByVeyra = window.__VEYRA_PROXY__ === true && window.parent !== window;
    const access = proxiedByVeyra ? await verifyThroughVeyra() : await verifyDirectSession();
    if (!access.allowed) return deny(access.reason);
    loadRunner();
  }

  start().catch(() => deny("Could not verify administrator access. Reload the page or open it again from Veyra’s menu."));
})();
