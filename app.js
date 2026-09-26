const API="https://veyraserver-xscy.onrender.com";
const $=id=>document.getElementById(id);

// --- Settings (persisted) ---------------------------------------------------
const DEFAULT_SETTINGS={searchEngine:"google",homepage:"",confirmCloseWithCrawl:false,autoStopPrevious:true,devRefreshMs:1500};
let settings={...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem("veyra-settings")||"{}")};
function saveSettings(){localStorage.setItem("veyra-settings",JSON.stringify(settings))}

// --- App state: real multi-tab model ---------------------------------------
// Each tab owns its own url/job/history/resources/links so switching tabs
// (or opening a new page) never bleeds one crawl's data into another — this
// also fixes the previous bug where an old crawl kept running/showing after
// navigating to a new page.
const state={
  tabs:[],activeId:null,tabSeq:0,
  logs:[],netLog:[],devTimer:null,devNetFilter:"all",
  bookmarked:new Set(JSON.parse(localStorage.getItem("veyra-bookmarks")||"[]"))
};
function makeTab(){
  return {
    id:"t"+(++state.tabSeq),title:"New Tab",url:"",jobId:null,done:false,
    history:[],histIndex:-1,view:"home",
    remoteLogIds:new Set(),resources:[],links:[],selected:-1,poll:null
  };
}
function activeTab(){return state.tabs.find(t=>t.id===state.activeId)}

// --- /dev network capture ---------------------------------------------------
// Transparently records every call this frontend makes to the Veyra backend
// (method, path, status, latency) so the /dev panel can show a live network
// log without touching every call site.
const __rawFetch=window.fetch.bind(window);
window.fetch=function(input,init){
  const url=typeof input==="string"?input:(input&&input.url)||"";
  const isApi=url.indexOf(API)===0;
  const method=(init&&init.method)||(typeof input!=="string"&&input&&input.method)||"GET";
  const start=performance.now();
  const p=__rawFetch(input,init);
  if(isApi){
    p.then(res=>logNet(method,url,res.status,performance.now()-start)).catch(()=>logNet(method,url,"ERR",performance.now()-start));
  }
  return p;
};
function logNet(method,url,status,ms){
  let path=url;try{const u=new URL(url);path=u.pathname+(u.search?u.search.slice(0,60):"")}catch{}
  state.netLog.push({time:new Date(),method,path,status,ms:Math.round(ms)});
  if(state.netLog.length>300)state.netLog.splice(0,state.netLog.length-300);
  if(!$("devPanel").classList.contains("hidden"))renderDevNet();
}

function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function pathOf(u){try{const x=new URL(u);return (x.pathname||"/")+(x.search||"")}catch{return u}}
function hostOf(u){try{return new URL(u).hostname.replace(/^www\./,"")}catch{return "Veyra Browse"}}
function addLog(level,msg){
  state.logs.push({time:new Date(),level,message:String(msg)});
  if(state.logs.length>2000)state.logs.splice(0,state.logs.length-2000);
  if(!$("consolePanel").classList.contains("hidden"))renderConsole();
}
function setLoading(on,pct=0){
  const line=$("loadProgress");
  line.style.width=on?`${Math.max(6,Math.min(100,pct))}%`:"0%";
  $("frameLoader").classList.toggle("hidden",!on);
}
function updateIdentity(url){
  if(!url){$("address").value="";return}
  $("scheme").textContent=(new URL(url).protocol||"https:").replace(":","");
  $("siteState").style.color=(new URL(url).protocol==="https:")?"#7aa6df":"#cfad6b";
  $("starBtn").classList.toggle("saved",state.bookmarked.has(url));
  $("address").value=url;
}
function normalize(input){
  let v=String(input||"").trim();if(!v)return null;
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(v))return v;
  if(/^[\w.-]+\.[A-Za-z]{2,}(\/.*)?$/.test(v))return "https://"+v;
  const engines={google:"https://www.google.com/search?q=",bing:"https://www.bing.com/search?q=",duckduckgo:"https://duckduckgo.com/?q="};
  return (engines[settings.searchEngine]||engines.google)+encodeURIComponent(v);
}

// --- Clean-path routing (no #/hash) ------------------------------------------
// In-app navigation to /dev and /settings updates the address bar via the
// History API with a plain path instead of a "#/" hash fragment. Note: since
// this is a static single-page app, a hard refresh at /dev or /settings will
// only work if the host is configured to fall back all paths to index.html —
// otherwise it 404s. Within the app (clicking, tabs, back/forward) it's clean.
function setPath(path){ if(location.pathname!==path)history.pushState({veyraPath:path},"",path) }
window.addEventListener("popstate",()=>{
  const p=location.pathname;
  if(p==="/dev")setTool("devPanel");
  else if(p==="/settings")setTool("settingsPanel");
  else restoreTabView(activeTab());
});

// --- Tab bar ------------------------------------------------------------------
function renderTabs(){
  const list=$("tabsList");
  list.innerHTML=state.tabs.map(t=>`
    <div class="tab ${t.id===state.activeId?"active":""}" data-tab="${t.id}">
      <span class="tab-favicon"><svg><use href="#i-globe"/></svg></span>
      <span class="tab-title">${esc(t.title||"New Tab")}</span>
      <button class="tab-close" data-close="${t.id}" title="Close tab (Ctrl/Cmd+W, Alt+W)">×</button>
    </div>`).join("");
  list.querySelectorAll(".tab").forEach(el=>el.addEventListener("click",e=>{
    if(e.target.closest("[data-close]"))return;
    switchTab(el.dataset.tab);
  }));
  list.querySelectorAll("[data-close]").forEach(btn=>btn.addEventListener("click",e=>{
    e.stopPropagation();closeTab(btn.dataset.close);
  }));
}
function switchTab(id){
  if(id===state.activeId||!state.tabs.some(t=>t.id===id))return;
  state.activeId=id;
  renderTabs();
  if(!$("toolView").classList.contains("hidden")){
    const panel=document.querySelector(".tool-tab.active")?.dataset.panel||"sourcePanel";
    setTool(panel);
  }else{
    restoreTabView(activeTab());
  }
}
function restoreTabView(t){
  if(!t)return;
  if(t.view==="browser"&&t.url){
    showBrowser();updateIdentity(t.url);
    $("pageFrame").src=API+"/api/view?url="+encodeURIComponent(t.url);
    $("pageState").textContent=t.done?(t.jobId?"Ready":"Ready"):(t.jobId?"Loading…":"Ready");
    $("serverState").textContent=t.done?"Crawler finished":(t.jobId?"Crawling…":"Crawler idle");
    $("serverState").className="server-pill"+(!t.done&&t.jobId?" live":"");
    setLoading(!t.done&&!!t.jobId,50);
  }else{
    showHome();
  }
}
function closeTab(id){
  const idx=state.tabs.findIndex(t=>t.id===id);if(idx<0)return;
  const t=state.tabs[idx];
  if(settings.confirmCloseWithCrawl&&t.jobId&&!t.done){
    if(!confirm("This tab has an active crawl running. Close it anyway?"))return;
  }
  if(t.poll)clearInterval(t.poll);
  if(t.jobId&&!t.done)stopJob(t.jobId,true);
  state.tabs.splice(idx,1);
  if(state.tabs.length===0){
    const nt=makeTab();state.tabs.push(nt);state.activeId=nt.id;
  }else if(state.activeId===id){
    state.activeId=state.tabs[Math.max(0,idx-1)].id;
  }
  renderTabs();
  restoreTabView(activeTab());
}
function newTabAction(){
  const t=makeTab();state.tabs.push(t);state.activeId=t.id;renderTabs();
  if(settings.homepage)openPage(settings.homepage);else showHome();
}
function cycleTab(delta){
  const n=state.tabs.length;if(n<2)return;
  const idx=state.tabs.findIndex(t=>t.id===state.activeId);
  switchTab(state.tabs[(idx+delta+n)%n].id);
}

function showHome(){
  const t=activeTab();if(t)t.view="home";
  $("homeView").classList.remove("hidden");$("browserView").classList.add("hidden");$("toolView").classList.add("hidden");
  $("address").value="";$("scheme").textContent="https";$("pageState").textContent="Ready";
  setLoading(false);setPath("/");renderTabs();
}
function showBrowser(){
  const t=activeTab();if(t)t.view="browser";
  $("homeView").classList.add("hidden");$("browserView").classList.remove("hidden");$("toolView").classList.add("hidden");
  setPath("/");
}
function setTool(panel){
  $("homeView").classList.add("hidden");$("browserView").classList.add("hidden");$("toolView").classList.remove("hidden");
  document.querySelectorAll(".tool-tab").forEach(x=>x.classList.toggle("active",x.dataset.panel===panel));
  ["sourcePanel","linkPanel","consolePanel","devPanel","settingsPanel"].forEach(id=>$(id).classList.toggle("hidden",id!==panel));
  if(panel==="sourcePanel")renderResources();
  if(panel==="linkPanel")loadLinks();
  if(panel==="consolePanel")renderConsole();
  if(panel==="devPanel"){refreshDev();startDevAuto()}
  else if(state.devTimer){clearInterval(state.devTimer);state.devTimer=null}
  if(panel==="settingsPanel")renderSettingsForm();
  setPath(panel==="devPanel"?"/dev":panel==="settingsPanel"?"/settings":"/");
}

// --- Navigation / crawling ----------------------------------------------------
async function openPage(input,push=true){
  const url=normalize(input);if(!url)return;
  let parsed;try{parsed=new URL(url)}catch{return}
  if(!/^https?:$/.test(parsed.protocol)){addLog("warn","Only HTTP(S) URLs are supported.");return}
  const t=activeTab();if(!t)return;

  // Bug fix: previously an old crawl for the last page kept running (and its
  // stale resources/links stayed on screen) after navigating to a new page.
  // Stop it and clear this tab's per-page data before starting the new crawl.
  if(t.poll){clearInterval(t.poll);t.poll=null}
  if(settings.autoStopPrevious&&t.jobId&&!t.done)stopJob(t.jobId,true);
  t.resources=[];t.links=[];t.selected=-1;t.remoteLogIds=new Set();t.done=false;t.jobId=null;
  t.view="browser";t.url=url;t.title=hostOf(url);

  showBrowser();updateIdentity(url);setLoading(true,14);
  $("pageState").textContent="Connecting…";$("serverState").textContent="Starting crawler";$("serverState").className="server-pill warn";
  addLog("info","Opening "+url);
  if(push){t.history=t.history.slice(0,t.histIndex+1);t.history.push(url);t.histIndex=t.history.length-1}
  renderTabs();
  try{
    const r=await fetch(API+"/api/open",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    const b=await r.json();if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    t.jobId=b.jobId;t.url=b.url;
    if(activeTab()===t){
      $("address").value=b.url;$("pageState").textContent="Loading "+hostOf(b.url)+"…";setLoading(true,38);
      $("pageFrame").src=API+"/api/view?url="+encodeURIComponent(b.url);
    }
    startPolling(t);
  }catch(e){
    if(activeTab()===t){setLoading(false);$("pageState").textContent="Could not load page";$("serverState").textContent="Backend error";$("serverState").className="server-pill warn"}
    addLog("error","Open failed: "+(e.stack||e.message||e));
  }
}
function reloadActive(){
  const t=activeTab();if(!t)return;
  if(t.view==="browser"&&t.url)openPage(t.url,false);
}
function startPolling(t){
  if(t.poll)clearInterval(t.poll);
  pollJob(t);t.poll=setInterval(()=>pollJob(t),500);
}
async function pollJob(t){
  if(!state.tabs.includes(t))return;
  try{
    const r=await fetch(API+"/api/crawl/"+encodeURIComponent(t.jobId));const b=await r.json();
    if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    if(!state.tabs.includes(t))return;
    const isActive=activeTab()===t;
    const c=b.counts||{};const gb=((c.bytesScanned||0)/1073741824).toFixed(2);
    if(isActive){
      $("crawlSummary").textContent=`Crawler: ${c.processed||0} processed · ${c.htmlPages||0} HTML · ${c.css||0} CSS · ${c.js||0} JS · ${c.links||0} links · ${gb} GB scanned`;
      $("backendHealth").textContent="Backend: online";
      $("serverState").textContent=b.done?(b.status==="done"?"Crawler finished":"Crawler stopped"):`Crawling · ${c.links||0} links`;
      $("serverState").className="server-pill"+(b.done?"":" live");
      $("loadProgress").style.width=b.done?"100%":`${Math.min(88,42+(c.processed||0)/Math.max(1,c.processed+(c.queued||0)+4)*45)}%`;
    }
    for(const x of (b.logs||[])){
      if(t.remoteLogIds.has(x.id))continue;
      t.remoteLogIds.add(x.id);state.logs.push({time:new Date(x.time),level:x.level,message:`[${hostOf(t.url)}] `+x.message});
    }
    if(state.logs.length>2000)state.logs.splice(0,state.logs.length-2000);
    if(!$("consolePanel").classList.contains("hidden"))renderConsole();
    if(b.done){
      if(t.poll){clearInterval(t.poll);t.poll=null}
      t.done=true;
      await loadResources(t);await loadLinks(t);
      if(isActive){setLoading(false);$("pageState").textContent=b.statusText||"Ready"}
      addLog("info","["+hostOf(t.url)+"] "+(b.statusText||"Crawler finished."));
    }
  }catch(e){
    if(activeTab()===t)$("backendHealth").textContent="Backend: error";
    addLog("error","Crawler status error: "+(e.message||e));
  }
}
async function loadResources(t=activeTab()){
  if(!t||!t.jobId)return;
  try{
    const r=await fetch(API+"/api/crawl/"+encodeURIComponent(t.jobId)+"/resources");const b=await r.json();
    if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    t.resources=b.resources||[];
    if(activeTab()===t)renderResources();
  }catch(e){addLog("error","Source list failed: "+(e.message||e))}
}
function renderResources(){
  const t=activeTab();const box=$("resourceList");if(!box||!t)return;
  if(!t.resources.length){box.innerHTML='<div class="empty">No captured resources yet.</div>';return}
  const q=($("sourceTitle").dataset.filter||"").toLowerCase();
  const arr=t.resources.filter(r=>!q||r.url.toLowerCase().includes(q)||r.type.includes(q));
  box.innerHTML=arr.map(r=>`<div class="resource ${r.id===t.selected?"active":""}" data-id="${r.id}">
    <div class="rtype">${esc(r.type)} · ${esc(String(r.status))}</div>
    <div class="rurl">${esc(pathOf(r.url))}</div>
    <div class="rmeta">${esc(r.url)} · ${esc(r.bytesLabel||"")}${r.truncated?" · truncated":""}</div>
  </div>`).join("");
  box.querySelectorAll(".resource").forEach(el=>el.onclick=()=>selectResource(Number(el.dataset.id)));
}
async function selectResource(id){
  const t=activeTab();if(!t)return;
  t.selected=id;renderResources();
  const r=t.resources.find(x=>x.id===id);if(!r)return;
  $("sourceTitle").textContent=r.type.toUpperCase()+" — "+pathOf(r.url);$("sourceMeta").textContent=`${r.url} · ${r.status} · ${r.bytesLabel||""}`;$("sourceCode").textContent="Loading source…";
  try{
    const resp=await fetch(API+"/api/crawl/"+encodeURIComponent(t.jobId)+"/source/"+encodeURIComponent(id));const b=await resp.json();
    if(!resp.ok)throw new Error(b.error||"HTTP "+resp.status);
    $("sourceCode").textContent=b.source||"[empty]";
  }catch(e){$("sourceCode").textContent="SOURCE ERROR\n\n"+(e.stack||e.message||e);addLog("error","Source fetch failed: "+(e.message||e))}
}
async function loadLinks(t=activeTab()){
  if(!t||!t.jobId)return;
  try{
    const r=await fetch(API+"/api/crawl/"+encodeURIComponent(t.jobId)+"/links");const b=await r.json();
    if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    t.links=b.links||[];
    if(activeTab()!==t)return;
    $("linkCount").textContent=t.links.length;
    $("linkBody").innerHTML=t.links.map(l=>`<tr><td><a href="${esc(API+"/api/view?url="+encodeURIComponent(l.url))}" target="_blank" rel="noopener">${esc(pathOf(l.url))}</a></td><td>${esc(l.url)}</td><td>${esc(l.type)}</td><td>${esc(pathOf(l.source))}</td><td>${l.captured?"captured":"discovered"}</td></tr>`).join("");
  }catch(e){addLog("error","Links failed: "+(e.message||e))}
}
function renderConsole(){
  const filter=$("consoleFilter").value;const rows=state.logs.filter(x=>filter==="all"||x.level===filter);
  if(!rows.length){$("consoleLog").innerHTML='<div class="empty">No matching logs.</div>';return}
  $("consoleLog").innerHTML=rows.map(x=>`<div class="log ${x.level}"><span class="time">${new Date(x.time).toLocaleTimeString([], {hour12:false})}</span><span class="level">${esc(x.level.toUpperCase())}</span><span class="msg">${esc(x.message)}</span></div>`).join("");
  $("consoleLog").scrollTop=$("consoleLog").scrollHeight;
}
async function health(){
  try{const r=await fetch(API+"/health");if(!r.ok)throw new Error("HTTP "+r.status);$("backendHealth").textContent="Backend: online"}
  catch(e){$("backendHealth").textContent="Backend: offline";addLog("error","Backend health check failed: "+(e.message||e))}
}
function toggleMenu(){ $("menuPanel").classList.toggle("hidden") }
function closeMenu(){ $("menuPanel").classList.add("hidden") }
function saveBookmark(){
  const t=activeTab();if(!t||!t.url)return;
  if(state.bookmarked.has(t.url))state.bookmarked.delete(t.url);else state.bookmarked.add(t.url);
  localStorage.setItem("veyra-bookmarks",JSON.stringify([...state.bookmarked]));$("starBtn").classList.toggle("saved",state.bookmarked.has(t.url));
  addLog("info",state.bookmarked.has(t.url)?"Bookmarked "+t.url:"Removed bookmark.");
}

// --- /dev panel: live crawl view, worker gauges, server health, network log, stop ---
function fmtBytes(n){
  n=Number(n)||0;
  if(n<1024)return n+" B";
  if(n<1024*1024)return (n/1024).toFixed(1)+" KB";
  if(n<1024*1024*1024)return (n/1024/1024).toFixed(2)+" MB";
  return (n/1024/1024/1024).toFixed(2)+" GB";
}
function fmtMs(ms){
  ms=Number(ms)||0;const s=Math.floor(ms/1000);
  if(s<60)return s+"s";
  const m=Math.floor(s/60);if(m<60)return m+"m "+(s%60)+"s";
  const h=Math.floor(m/60);return h+"h "+(m%60)+"m";
}
function devPct(a,b){return b>0?Math.max(0,Math.min(100,(a/b)*100)):0}
async function refreshDev(){
  await Promise.allSettled([refreshDevJob(),refreshDevAllJobs(),refreshDevSystem()]);
  renderDevNet();
}
async function refreshDevJob(){
  const grid=$("devJobGrid");const t=activeTab();
  if(!t||!t.jobId){
    grid.innerHTML='<div class="empty">No active crawl. Open a page to start one.</div>';
    ["devBarResources","devBarScan","devBarHtml","devBarAsset"].forEach(id=>$(id).style.width="0%");
    $("devRawJson").textContent="—";
    return;
  }
  try{
    const r=await fetch(API+"/api/crawl/"+encodeURIComponent(t.jobId));const b=await r.json();
    if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    const c=b.counts||{},w=b.workers||{html:{},asset:{}};
    grid.innerHTML=`
      <div><span>Job</span><b>${esc(b.id)}</b></div>
      <div><span>Root</span><b>${esc(b.url)}</b></div>
      <div><span>Status</span><b class="dev-status dev-${esc(b.status)}">${esc(b.statusText||b.status)}</b></div>
      <div><span>Elapsed</span><b>${fmtMs(b.elapsedMs||0)}</b></div>
      <div><span>Processed</span><b>${(c.processed||0).toLocaleString()}</b></div>
      <div><span>Queued</span><b>${(c.queued||0).toLocaleString()}</b></div>
      <div><span>HTML / CSS / JS</span><b>${(c.htmlPages||0).toLocaleString()} / ${(c.css||0).toLocaleString()} / ${(c.js||0).toLocaleString()}</b></div>
      <div><span>Links found</span><b>${(c.links||0).toLocaleString()}</b></div>
      <div><span>Bytes scanned</span><b>${fmtBytes(c.bytesScanned||0)}</b></div>
      <div><span>robots.txt / sitemaps</span><b>${b.robotsLoaded?"loaded":"none"} · ${b.sitemapsFound||0}</b></div>
    `;
    $("devBarResources").style.width=devPct(c.processed||0,b.maxUrls||1)+"%";
    $("devBarResourcesLabel").textContent=`${(c.processed||0).toLocaleString()} / ${(b.maxUrls||0).toLocaleString()}`;
    $("devBarScan").style.width=devPct(c.bytesScanned||0,b.maxScanBytes||1)+"%";
    $("devBarScanLabel").textContent=`${fmtBytes(c.bytesScanned||0)} / ${fmtBytes(b.maxScanBytes||0)}`;
    $("devBarHtml").style.width=devPct(w.html.active||0,w.html.max||1)+"%";
    $("devBarHtmlLabel").textContent=`${w.html.active||0} / ${w.html.max||0} active · ${w.html.queued||0} queued`;
    $("devBarAsset").style.width=devPct(w.asset.active||0,w.asset.max||1)+"%";
    $("devBarAssetLabel").textContent=`${w.asset.active||0} / ${w.asset.max||0} active · ${w.asset.queued||0} queued`;
    $("devRawJson").textContent=JSON.stringify(b,null,2);
  }catch(e){grid.innerHTML=`<div class="empty">Job status error: ${esc(e.message||e)}</div>`}
}
async function refreshDevAllJobs(){
  const body=$("devJobsBody");const t=activeTab();
  try{
    const r=await fetch(API+"/api/debug/jobs");const b=await r.json();if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    const rows=b.jobs||[];
    body.innerHTML=rows.length?rows.map(j=>`<tr class="${j.id===t?.jobId?"active":""}">
      <td>${esc(j.id.slice(0,8))}</td><td>${esc(j.url)}</td><td>${esc(j.status)}</td>
      <td>${(j.counts?.processed||0).toLocaleString()}</td><td>${(j.counts?.links||0).toLocaleString()}</td>
      <td><button class="secondary tiny" data-job="${esc(j.id)}" ${j.done?"disabled":""}>Stop</button></td>
    </tr>`).join(""):'<tr><td colspan="6" class="empty">No jobs on server yet.</td></tr>';
    body.querySelectorAll("button[data-job]").forEach(btn=>btn.onclick=()=>stopJob(btn.dataset.job));
  }catch(e){body.innerHTML=`<tr><td colspan="6" class="empty">Failed: ${esc(e.message||e)}</td></tr>`}
}
async function refreshDevSystem(){
  const grid=$("devSystemGrid");
  try{
    const t0=performance.now();
    const r=await fetch(API+"/api/debug/system");const b=await r.json();if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    const latency=Math.round(performance.now()-t0);
    grid.innerHTML=`
      <div><span>Backend</span><b class="dev-status dev-done">online · ${latency}ms</b></div>
      <div><span>Uptime</span><b>${fmtMs((b.uptimeSec||0)*1000)}</b></div>
      <div><span>Node</span><b>${esc(b.nodeVersion||"?")}</b></div>
      <div><span>Memory (RSS)</span><b>${fmtBytes(b.memory?.rss||0)}</b></div>
      <div><span>Heap used / total</span><b>${fmtBytes(b.memory?.heapUsed||0)} / ${fmtBytes(b.memory?.heapTotal||0)}</b></div>
      <div><span>Jobs (active/total)</span><b>${b.jobs?.active||0} / ${b.jobs?.total||0}</b></div>
      <div><span>Proxy cache entries</span><b>${b.proxyCacheEntries||0}</b></div>
    `;
  }catch(e){grid.innerHTML=`<div class="empty dev-status dev-error">Backend unreachable: ${esc(e.message||e)}</div>`}
}
function renderDevNet(){
  const body=$("devNetBody");if(!body)return;
  const f=state.devNetFilter;
  const rows=state.netLog.slice().reverse().filter(x=>{
    if(f==="all")return true;
    const bad=x.status==="ERR"||Number(x.status)>=400;
    return f==="err"?bad:!bad;
  }).slice(0,120);
  body.innerHTML=rows.length?rows.map(x=>`<tr class="${x.status==="ERR"||Number(x.status)>=400?"neterr":""}">
    <td>${new Date(x.time).toLocaleTimeString([], {hour12:false})}</td><td>${esc(x.method)}</td><td>${esc(x.path)}</td><td>${esc(String(x.status))}</td><td>${x.ms}</td>
  </tr>`).join(""):'<tr><td colspan="5" class="empty">No requests yet.</td></tr>';
}
async function stopJob(id,silent){
  if(!id)return;
  try{
    const r=await fetch(API+"/api/crawl/"+encodeURIComponent(id)+"/stop",{method:"POST"});
    const b=await r.json();if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    if(!silent)addLog("warn","Stop requested for job "+id+".");
    refreshDev();
  }catch(e){if(!silent)addLog("error","Stop failed: "+(e.message||e))}
}
function startDevAuto(){
  if(state.devTimer){clearInterval(state.devTimer);state.devTimer=null}
  if($("devAutoRefresh").checked)state.devTimer=setInterval(refreshDev,settings.devRefreshMs||1500);
}

// --- /settings panel ----------------------------------------------------------
function renderSettingsForm(){
  $("setSearchEngine").value=settings.searchEngine;
  $("setHomepage").value=settings.homepage||"";
  $("setConfirmClose").checked=!!settings.confirmCloseWithCrawl;
  $("setAutoStop").checked=settings.autoStopPrevious!==false;
  $("setDevInterval").value=settings.devRefreshMs||1500;
}
function wireSettingsForm(){
  $("setSearchEngine").onchange=e=>{settings.searchEngine=e.target.value;saveSettings();addLog("info","Search engine set to "+e.target.value+".")};
  $("setHomepage").onchange=e=>{settings.homepage=e.target.value.trim();saveSettings();addLog("info","Homepage updated.")};
  $("setConfirmClose").onchange=e=>{settings.confirmCloseWithCrawl=e.target.checked;saveSettings()};
  $("setAutoStop").onchange=e=>{settings.autoStopPrevious=e.target.checked;saveSettings()};
  $("setDevInterval").onchange=e=>{settings.devRefreshMs=Math.max(500,Number(e.target.value)||1500);saveSettings();startDevAuto()};
  $("settingsResetBtn").onclick=()=>{settings={...DEFAULT_SETTINGS};saveSettings();renderSettingsForm();addLog("info","Settings reset to defaults.")};
  $("settingsClearBookmarks").onclick=()=>{state.bookmarked.clear();localStorage.setItem("veyra-bookmarks","[]");const t=activeTab();if(t)updateIdentity(t.url);addLog("info","Bookmarks cleared.")};
  $("settingsClearLogs").onclick=()=>{state.logs=[];state.netLog=[];renderConsole();renderDevNet();addLog("info","Console and network logs cleared.")};
}

// --- Keyboard shortcuts --------------------------------------------------------
// Note on platform limits: real browsers reserve Ctrl/Cmd+T (new tab),
// Ctrl/Cmd+W (close tab), Ctrl+Tab (switch tabs) and Ctrl/Cmd+L (address bar)
// at the browser-chrome level, so a web page's own JS generally cannot
// intercept them — this is an intentional browser security/usability rule,
// not a bug here. Each shortcut below is bound to both the "expected" combo
// (which will work in some browsers/embedders) and an Alt-based combo that
// reliably reaches the page in every browser.
function isMac(){return /Mac|iPod|iPhone|iPad/.test(navigator.platform||navigator.userAgent||"")}
function primaryMod(e){return isMac()?e.metaKey:e.ctrlKey}
window.addEventListener("keydown",e=>{
  const typingPlain=["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)&&!e.altKey&&!primaryMod(e);
  const mod=primaryMod(e);
  const key=e.key.toLowerCase();

  if(mod&&!e.shiftKey&&key==="r"){e.preventDefault();reloadActive();return}                     // Reload
  if((mod&&key==="t")||(e.altKey&&key==="t")){e.preventDefault();newTabAction();return}          // New tab
  if((mod&&key==="w")||(e.altKey&&key==="w")){e.preventDefault();closeTab(state.activeId);return} // Close tab
  if((mod&&key==="tab"&&!e.shiftKey)||(e.altKey&&key==="]")){e.preventDefault();cycleTab(1);return}   // Next tab
  if((mod&&key==="tab"&&e.shiftKey)||(e.altKey&&key==="[")){e.preventDefault();cycleTab(-1);return}   // Prev tab
  if((mod&&key==="l")||(!typingPlain&&key==="/")){e.preventDefault();$("address").focus();$("address").select();return} // Focus address bar
  if(mod&&!e.shiftKey&&key==="d"){e.preventDefault();saveBookmark();return}                      // Bookmark
  if(mod&&e.shiftKey&&key==="d"){e.preventDefault();setTool("devPanel");return}                  // /dev
  if(mod&&key===","){e.preventDefault();setTool("settingsPanel");return}                         // /settings
  if(!typingPlain&&key==="escape"){const t=activeTab();if(t?.jobId&&!t.done)stopJob(t.jobId);return} // Stop crawl
  if(e.altKey&&key==="arrowleft"){e.preventDefault();$("backBtn").click();return}
  if(e.altKey&&key==="arrowright"){e.preventDefault();$("forwardBtn").click();return}
});

// --- Wiring ---------------------------------------------------------------------
$("address").onkeydown=e=>{if(e.key==="Enter")openPage($("address").value)};
$("homeBrowse").onclick=()=>openPage($("homeInput").value);
$("homeInput").onkeydown=e=>{if(e.key==="Enter")openPage($("homeInput").value)};
document.querySelectorAll(".shortcuts button").forEach(b=>b.onclick=()=>openPage(b.dataset.url));
$("homeBtn").onclick=showHome;
$("newTab").onclick=newTabAction;
$("reloadBtn").onclick=reloadActive;
$("backBtn").onclick=()=>{const t=activeTab();if(t&&t.histIndex>0){t.histIndex--;openPage(t.history[t.histIndex],false)}};
$("forwardBtn").onclick=()=>{const t=activeTab();if(t&&t.histIndex<t.history.length-1){t.histIndex++;openPage(t.history[t.histIndex],false)}};
$("starBtn").onclick=saveBookmark;
$("toolsMenuBtn").onclick=()=>setTool("sourcePanel");
document.querySelectorAll(".tool-tab").forEach(x=>x.onclick=()=>setTool(x.dataset.panel));
$("backToPage").onclick=()=>restoreTabView(activeTab());
$("menuBtn").onclick=toggleMenu;
$("menuSource").onclick=()=>{closeMenu();setTool("sourcePanel")};
$("menuLinks").onclick=()=>{closeMenu();setTool("linkPanel")};
$("menuConsole").onclick=()=>{closeMenu();setTool("consolePanel")};
$("menuDev").onclick=()=>{closeMenu();setTool("devPanel")};
$("menuSettings").onclick=()=>{closeMenu();setTool("settingsPanel")};
$("menuHome").onclick=()=>{closeMenu();showHome()};
$("consoleFilter").onchange=renderConsole;
$("clearConsole").onclick=()=>{state.logs=[];renderConsole();addLog("info","Console cleared.")};
$("copyConsole").onclick=async()=>{try{await navigator.clipboard.writeText(state.logs.map(x=>`[${new Date(x.time).toISOString()}] [${x.level.toUpperCase()}] ${x.message}`).join("\n"));addLog("info","Console copied.")}catch(e){addLog("error","Copy failed: "+(e.message||e))}};
$("devRefreshBtn").onclick=refreshDev;
$("devStopBtn").onclick=()=>{const t=activeTab();if(t?.jobId)stopJob(t.jobId);else addLog("warn","No active crawl to stop.")};
$("devAutoRefresh").onchange=startDevAuto;
$("devNetFilter").onchange=e=>{state.devNetFilter=e.target.value;renderDevNet()};
$("devNetClear").onclick=()=>{state.netLog=[];renderDevNet()};
$("devCopyJsonBtn").onclick=async()=>{try{await navigator.clipboard.writeText($("devRawJson").textContent||"");addLog("info","Raw job JSON copied.")}catch(e){addLog("error","Copy failed: "+(e.message||e))}};
$("devExportBtn").onclick=()=>{const t=activeTab();if(!t?.jobId){addLog("warn","No active crawl to export.");return}window.open(API+"/api/crawl/"+encodeURIComponent(t.jobId)+"/export","_blank")};
wireSettingsForm();
$("pageFrame").addEventListener("load",()=>{const t=activeTab();$("pageState").textContent=t&&t.url?hostOf(t.url):"Ready";setLoading(false)});
$("pageFrame").addEventListener("loadstart",()=>setLoading(true,60));
window.addEventListener("message",e=>{
  const d=e.data||{};if(d.type!=="veyra:navigate"||!d.url)return;
  const t=activeTab();if(!t)return;
  const u=normalize(d.url);if(!u)return;
  t.url=u;t.title=hostOf(u);
  $("address").value=u;renderTabs();
  addLog("debug","Page navigation: "+u);
});
window.addEventListener("error",e=>addLog("error",`Frontend error: ${e.message} @ ${e.filename||"inline"}:${e.lineno||"?"}`));
window.addEventListener("unhandledrejection",e=>addLog("error","Unhandled promise: "+(e.reason?.stack||e.reason||"")));
document.addEventListener("click",e=>{if(!$("menuPanel").contains(e.target)&&e.target!==$("menuBtn"))closeMenu()});

// --- Boot -----------------------------------------------------------------------
const firstTab=makeTab();state.tabs.push(firstTab);state.activeId=firstTab.id;renderTabs();
if(location.pathname==="/dev")setTool("devPanel");
else if(location.pathname==="/settings")setTool("settingsPanel");
else if(settings.homepage)openPage(settings.homepage);
else showHome();
health();
addLog("info","Veyra Browse is ready. High-throughput background crawler enabled.");
