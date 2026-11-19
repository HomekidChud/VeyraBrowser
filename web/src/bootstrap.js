/* Global startup shared by root and /browse entry pages. */
(() => {
  document.title = "/web";
  const knownRoutes = /^(.*?)\/(?:browse|search|calculator|downloads|history|extensions|settings|vpn|dev|admin|console|resources|links|incognito|cast|internet)(?:\/.*)?$/;
  const match = location.pathname.match(knownRoutes);
  const base = match ? `${match[1]}/` : location.pathname.replace(/[^/]*$/, "");
  window.VEYRA_BASE = base;
  if (/\/incognito\/?$/.test(location.pathname)) {
    location.replace(`${base}browse?incognito=1`);
    return;
  }
  try {
    const privateParam = new URLSearchParams(location.search).get("incognito");
    const privateWindow = privateParam === "1" || (privateParam !== "0" && sessionStorage.getItem("veyra-incognito") === "1");
    const saved = privateWindow ? {} : JSON.parse(localStorage.getItem("veyra-settings") || "{}");
    let theme = saved.theme || "dark";
    if (theme === "system") theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    if (saved.accent) document.documentElement.style.setProperty("--accent", saved.accent);
    if (saved.fontScale) document.documentElement.style.setProperty("--ui-scale", saved.fontScale);
  } catch {}
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet"; stylesheet.href = `${base}styles/style.css?v=8.33.0-studio`; document.head.appendChild(stylesheet);
  const studioStyle = document.createElement("link");
  studioStyle.rel = "stylesheet"; studioStyle.href = `${base}styles/studio.css?v=3`; document.head.appendChild(studioStyle);
  const velocityStyle = document.createElement("link");
  velocityStyle.rel = "stylesheet"; velocityStyle.href = `${base}styles/velocity.css?v=2`; document.head.appendChild(velocityStyle);
  [["icon", "assets/favicon.svg", "image/svg+xml"], ["icon", "assets/favicon.ico", ""], ["apple-touch-icon", "assets/apple-touch-icon.png", ""]].forEach(([rel, href, type]) => {
    const link = document.createElement("link"); link.rel = rel; link.href = base + href; if (type) link.type = type; document.head.appendChild(link);
  });

  const gateScript = document.createElement("script");
  gateScript.src = `${base}src/gate.js?v=8.29.1-session-privacy`;
  gateScript.onload = async () => {
    const unlocked = await (window.veyraGateCheck ? window.veyraGateCheck() : Promise.resolve(true));
    if (!unlocked) return;
    const app = document.createElement("script"); app.type = "module"; app.src = `${base}src/app.js?v=8.33.0-studio`; document.body.appendChild(app);
    if (location.protocol === "https:" && "serviceWorker" in navigator) {
      const privateWindow = new URLSearchParams(location.search).get("incognito") === "1";
      if (!privateWindow) navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
    }
  };
  gateScript.onerror = () => {
    const app = document.createElement("script"); app.type = "module"; app.src = `${base}src/app.js?v=8.33.0-studio`; document.body.appendChild(app);
  };
  document.head.appendChild(gateScript);
})();
