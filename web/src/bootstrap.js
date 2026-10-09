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
    const saved = JSON.parse(localStorage.getItem("veyra-settings") || "{}");
    let theme = saved.theme || "dark";
    if (theme === "system") theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    if (saved.accent) document.documentElement.style.setProperty("--accent", saved.accent);
    if (saved.fontScale) document.documentElement.style.setProperty("--ui-scale", saved.fontScale);
  } catch {}
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet"; stylesheet.href = `${base}styles/style.css?v=8.28.15-proxy-resources`; document.head.appendChild(stylesheet);
  [["icon", "assets/favicon.svg", "image/svg+xml"], ["icon", "assets/favicon.ico", ""], ["apple-touch-icon", "assets/apple-touch-icon.png", ""]].forEach(([rel, href, type]) => {
    const link = document.createElement("link"); link.rel = rel; link.href = base + href; if (type) link.type = type; document.head.appendChild(link);
  });
  window.addEventListener("DOMContentLoaded", () => {
    const app = document.createElement("script"); app.type = "module"; app.src = `${base}src/app.js?v=8.28.15-proxy-resources`; document.body.appendChild(app);
  }, { once: true });
  if (location.protocol === "https:" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
  }
})();
