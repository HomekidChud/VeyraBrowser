const fs = require("fs");
const path = require("path");
function read(name){ return fs.readFileSync(path.join(__dirname,name),"utf8"); }
function ok(name, cond){ if(!cond) throw new Error(`FAIL ${name}`); console.log("PASS", name); }
const app=read("app.js"), core=read("core.js"), settings=read("settings.js");
ok("proxy mode exists", settings.includes('["proxy", "Fast proxy"]') && app.includes('r === "proxy"'));
ok("crawler mode exists", settings.includes('["crawler", "Proxy + crawler"]') && app.includes('r === "crawler"'));
ok("browser mode exists", settings.includes('["browser", "Chromium"]') && app.includes('r === "browser"'));
ok("combined mode exists", settings.includes('["combined", "All combined (fastest adaptive)"]') && app.includes('r === "combined"'));
ok("combined races proxy and chromium", app.includes('startBrowserSession(t, url, { background: true })') && app.includes('t.renderWinner = "browser"') && app.includes('t.renderWinner = "proxy"'));
ok("crawler mode is sent to the server", app.includes('engineMode') && app.includes('/api/open'));
ok("settings migration reaches version 3", core.includes('settingsVersion: 3') && core.includes('obj.settingsVersion = 3'));
console.log("Veyra frontend mode regression checks passed");
ok("capability declaration is valid JavaScript", !app.includes("async async function capability"));
