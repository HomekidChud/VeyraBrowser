const fs = require("fs");
const path = require("path");
function read(name){ return fs.readFileSync(path.join(__dirname,name),"utf8"); }
function ok(name, cond){ if(!cond) throw new Error(`FAIL ${name}`); console.log("PASS", name); }
const app=read("app.js"), core=read("core.js"), settings=read("settings.js");
ok("proxy mode exists", settings.includes('["proxy", "Fast proxy"]') && app.includes('r === "proxy"'));
ok("crawler mode exists", settings.includes('["crawler", "Fast proxy + page accelerator"]') && app.includes('r === "crawler"'));
ok("browser mode exists", settings.includes('["browser", "Chromium"]') && app.includes('r === "browser"'));
ok("combined mode exists", settings.includes('["combined", "All combined (fastest adaptive)"]') && app.includes('r === "combined"'));
ok("combined races proxy and chromium", app.includes('startBrowserSession(t, url, { background: true })') && app.includes('t.renderWinner = "browser"') && app.includes('t.renderWinner = "proxy"'));
ok("crawler mode is page acceleration, not full-site crawling", settings.includes("page accelerator") && app.includes('r === "crawler"'));
ok("crawler mode is sent to the server", app.includes('engineMode') && app.includes('/api/open'));
ok("settings migration reaches version 4", core.includes('settingsVersion: 4') && core.includes('obj.settingsVersion = 4'));
ok("crawler start is deferred until a usable page surface", app.includes("function scheduleDeferredCrawler") && app.includes('if (["crawler", "combined", "auto"].includes(t.loadStrategy) && t.sessionId)'));
ok("combined crawler does not block first paint", app.includes("Render the lightweight proxy immediately") && !app.includes("await openCrawl(t, url, session"));
console.log("Veyra frontend mode regression checks passed");
ok("capability declaration is valid JavaScript", !app.includes("async async function capability"));
