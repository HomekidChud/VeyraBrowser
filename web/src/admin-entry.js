/* Static-host entry: load the shared browser shell and keep the admin route. */
(() => {
  const target = new URL(location.href);
  target.pathname = target.pathname.replace(/\/admin(?:\/index\.html)?\/?$/, "/");
  target.searchParams.set("veyra_route", "admin");
  if (target.href !== location.href) location.replace(target.href);
})();
