const API="https://veyraserver-xscy.onrender.com";
const state={
  jobId:null,currentUrl:"",history:[],histIndex:-1,poll:null,
  logs:[],remoteLogIds:new Set(),resources:[],selected:-1,links:[],
  bookmarked:new Set(JSON.parse(localStorage.getItem("veyra-bookmarks")||"[]")),
  netLog:[],devTimer:null,devNetFilter:"all"
};
const $=id=>document.getElementById(id);

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
  renderConsole();
}
function setLoading(on,pct=0){
  const line=$("loadProgress");
  line.style.width=on?`${Math.max(6,Math.min(100,pct))}%`:"0%";
  $("frameLoader").classList.toggle("hidden",!on);
}
function updateIdentity(url){
  $("tabTitle").textContent=hostOf(url);
  $("scheme").textContent=(new URL(url).protocol||"https:").replace(":","");
  $("siteState").style.color=(new URL(url).protocol==="https:")?"#7aa6df":"#cfad6b";
  $("starBtn").classList.toggle("saved",state.bookmarked.has(url));
  $("address").value=url;
}
function normalize(input){
  let v=String(input||"").trim();if(!v)return null;
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(v))return v;
  if(/^[\w.-]+\.[A-Za-z]{2,}(\/.*)?$/.test(v))return "https://"+v;
  return "https://www.google.com/search?q="+encodeURIComponent(v);
}
function showHome(){
  $("homeView").classList.remove("hidden");$("browserView").classList.add("hidden");$("toolView").classList.add("hidden");
  $("tabTitle").textContent="New Tab";$("address").value="";$("scheme").textContent="https";$("pageState").textContent="Ready";
  setLoading(false);
}
function showBrowser(){
  $("homeView").classList.add("hidden");$("browserView").classList.remove("hidden");$("toolView").classList.add("hidden");
}
function setTool(panel){
  $("homeView").classList.add("hidden");$("browserView").classList.add("hidden");$("toolView").classList.remove("hidden");
  document.querySelectorAll(".tool-tab").forEach(x=>x.classList.toggle("active",x.dataset.panel===panel));
  ["sourcePanel","linkPanel","consolePanel","devPanel"].forEach(id=>$(id).classList.toggle("hidden",id!==panel));
  if(panel==="sourcePanel")renderResources();
  if(panel==="linkPanel")loadLinks();
  if(panel==="consolePanel")renderConsole();
  if(panel==="devPanel"){refreshDev();startDevAuto()}
  else if(state.devTimer){clearInterval(state.devTimer);state.devTimer=null}
  if(location.hash!==(panel==="devPanel"?"#/dev":""))history.replaceState(null,"",panel==="devPanel"?"#/dev":location.pathname);
}
function navigateInternal(url,push=true){
  if(!url)return;
  state.currentUrl=url;
  updateIdentity(url);
  if(push){state.history=state.history.slice(0,state.histIndex+1);state.history.push(url);state.histIndex=state.history.length-1;}
  openPage(url,false);
}
async function openPage(input,push=true){
  const url=normalize(input);if(!url)return;
  let parsed;try{parsed=new URL(url)}catch{return}
  if(!/^https?:$/.test(parsed.protocol)){addLog("warn","Only HTTP(S) URLs are supported.");return}
  showBrowser();updateIdentity(url);setLoading(true,14);$("pageState").textContent="Connecting…";$("serverState").textContent="Starting crawler";$("serverState").className="server-pill warn";
  addLog("info","Opening "+url);
  if(push){state.history=state.history.slice(0,state.histIndex+1);state.history.push(url);state.histIndex=state.history.length-1;}
  try{
    const r=await fetch(API+"/api/open",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    const b=await r.json();if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    state.jobId=b.jobId;state.currentUrl=b.url;state.remoteLogIds.clear();
    $("address").value=b.url;$("pageState").textContent="Loading "+hostOf(b.url)+"…";setLoading(true,38);
    $("pageFrame").src=API+"/api/view?url="+encodeURIComponent(b.url);
    startPolling(b.jobId);
  }catch(e){
    setLoading(false);$("pageState").textContent="Could not load page";$("serverState").textContent="Backend error";$("serverState").className="server-pill warn";
    addLog("error","Open failed: "+(e.stack||e.message||e));
  }
}
function startPolling(jobId){
  if(state.poll)clearInterval(state.poll);
  pollJob(jobId);state.poll=setInterval(()=>pollJob(jobId),500);
}
async function pollJob(jobId){
  try{
    const r=await fetch(API+"/api/crawl/"+encodeURIComponent(jobId));const b=await r.json();
    if(!r.ok)throw new Error(b.error||"HTTP "+r.status);if(state.jobId!==jobId)return;
    const c=b.counts||{}; const gb=((c.bytesScanned||0)/1073741824).toFixed(2);
    $("crawlSummary").textContent=`Crawler: ${c.processed||0} processed · ${c.htmlPages||0} HTML · ${c.css||0} CSS · ${c.js||0} JS · ${c.links||0} links · ${gb} GB scanned`;
    $("backendHealth").textContent="Backend: online";
    $("serverState").textContent=b.done?(b.status==="done"?"Crawler finished":"Crawler stopped"):`Crawling · ${c.links||0} links`;
    $("serverState").className="server-pill"+(b.done?"":" live");
    $("loadProgress").style.width=b.done?"100%":`${Math.min(88,42+(c.processed||0)/Math.max(1,c.processed+(c.queued||0)+4)*45)}%`;
    for(const x of (b.logs||[])){
      if(state.remoteLogIds.has(x.id))continue;
      state.remoteLogIds.add(x.id);state.logs.push({time:new Date(x.time),level:x.level,message:"[server] "+x.message});
    }
    if(state.logs.length>2000)state.logs.splice(0,state.logs.length-2000);renderConsole();
    if(b.done){
      clearInterval(state.poll);state.poll=null;setLoading(false);
      $("pageState").textContent=b.statusText||"Ready";
      await loadResources();await loadLinks();
      addLog("info",b.statusText||"Crawler finished.");
    }
  }catch(e){$("backendHealth").textContent="Backend: error";addLog("error","Crawler status error: "+(e.message||e))}
}
async function loadResources(){
  if(!state.jobId)return;
  try{const r=await fetch(API+"/api/crawl/"+encodeURIComponent(state.jobId)+"/resources");const b=await r.json();if(!r.ok)throw new Error(b.error||"HTTP "+r.status);state.resources=b.resources||[];renderResources()}
  catch(e){addLog("error","Source list failed: "+(e.message||e))}
}
function renderResources(){
  const box=$("resourceList");if(!box)return;
  if(!state.resources.length){box.innerHTML='<div class="empty">No captured resources yet.</div>';return}
  const q=($("sourceTitle").dataset.filter||"").toLowerCase();
  const arr=state.resources.filter(r=>!q||r.url.toLowerCase().includes(q)||r.type.includes(q));
  box.innerHTML=arr.map(r=>`<div class="resource ${r.id===state.selected?"active":""}" data-id="${r.id}">
    <div class="rtype">${esc(r.type)} · ${esc(String(r.status))}</div>
    <div class="rurl">${esc(pathOf(r.url))}</div>
    <div class="rmeta">${esc(r.url)} · ${esc(r.bytesLabel||"")}${r.truncated?" · truncated":""}</div>
  </div>`).join("");
  box.querySelectorAll(".resource").forEach(el=>el.onclick=()=>selectResource(Number(el.dataset.id)));
}
async function selectResource(id){
  state.selected=id;renderResources();const r=state.resources.find(x=>x.id===id);if(!r)return;
  $("sourceTitle").textContent=r.type.toUpperCase()+" — "+pathOf(r.url);$("sourceMeta").textContent=`${r.url} · ${r.status} · ${r.bytesLabel||""}`;$("sourceCode").textContent="Loading source…";
  try{const resp=await fetch(API+"/api/crawl/"+encodeURIComponent(state.jobId)+"/source/"+encodeURIComponent(id));const b=await resp.json();if(!resp.ok)throw new Error(b.error||"HTTP "+resp.status);$("sourceCode").textContent=b.source||"[empty]"}
  catch(e){$("sourceCode").textContent="SOURCE ERROR\n\n"+(e.stack||e.message||e);addLog("error","Source fetch failed: "+(e.message||e))}
}
async function loadLinks(){
  if(!state.jobId)return;
  try{const r=await fetch(API+"/api/crawl/"+encodeURIComponent(state.jobId)+"/links");const b=await r.json();if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    state.links=b.links||[];$("linkCount").textContent=state.links.length;
    $("linkBody").innerHTML=state.links.map(l=>`<tr><td><a href="${esc(API+"/api/view?url="+encodeURIComponent(l.url))}" target="_blank" rel="noopener">${esc(pathOf(l.url))}</a></td><td>${esc(l.url)}</td><td>${esc(l.type)}</td><td>${esc(pathOf(l.source))}</td><td>${l.captured?"captured":"discovered"}</td></tr>`).join("");
  }catch(e){addLog("error","Links failed: "+(e.message||e))}
}
function renderConsole(){
  const filter=$("consoleFilter").value;const rows=state.logs.filter(x=>filter==="all"||x.level===filter);
  if(!rows.length){$("consoleLog").innerHTML='<div class="empty">No matching logs.</div>';return}
  $("consoleLog").innerHTML=rows.map(x=>`<div class="log ${x.level}"><span class="time">${new Date(x.time).toLocaleTimeString([], {hour12:false})}</span><span class="level">${esc(x.level.toUpperCase())}</span><span class="msg">${esc(x.message)}</span></div>`).join("");
  $("consoleLog").scrollTop=$("consoleLog").scrollHeight;
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
  const grid=$("devJobGrid");
  if(!state.jobId){
    grid.innerHTML='<div class="empty">No active crawl. Open a page to start one.</div>';
    ["devBarResources","devBarScan","devBarHtml","devBarAsset"].forEach(id=>$(id).style.width="0%");
    $("devRawJson").textContent="—";
    return;
  }
  try{
    const r=await fetch(API+"/api/crawl/"+encodeURIComponent(state.jobId));const b=await r.json();
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
  const body=$("devJobsBody");
  try{
    const r=await fetch(API+"/api/debug/jobs");const b=await r.json();if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    const rows=b.jobs||[];
    body.innerHTML=rows.length?rows.map(j=>`<tr class="${j.id===state.jobId?"active":""}">
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
async function stopJob(id){
  if(!id)return;
  try{
    const r=await fetch(API+"/api/crawl/"+encodeURIComponent(id)+"/stop",{method:"POST"});
    const b=await r.json();if(!r.ok)throw new Error(b.error||"HTTP "+r.status);
    addLog("warn","Stop requested for job "+id+".");refreshDev();
  }catch(e){addLog("error","Stop failed: "+(e.message||e))}
}
function startDevAuto(){
  if(state.devTimer){clearInterval(state.devTimer);state.devTimer=null}
  if($("devAutoRefresh").checked)state.devTimer=setInterval(refreshDev,1500);
}

async function health(){
  try{const r=await fetch(API+"/health");if(!r.ok)throw new Error("HTTP "+r.status);$("backendHealth").textContent="Backend: online"}
  catch(e){$("backendHealth").textContent="Backend: offline";addLog("error","Backend health check failed: "+(e.message||e))}
}
function toggleMenu(){ $("menuPanel").classList.toggle("hidden") }
function closeMenu(){ $("menuPanel").classList.add("hidden") }
function saveBookmark(){
  if(!state.currentUrl)return;
  if(state.bookmarked.has(state.currentUrl))state.bookmarked.delete(state.currentUrl);else state.bookmarked.add(state.currentUrl);
  localStorage.setItem("veyra-bookmarks",JSON.stringify([...state.bookmarked]));$("starBtn").classList.toggle("saved",state.bookmarked.has(state.currentUrl));
  addLog("info",state.bookmarked.has(state.currentUrl)?"Bookmarked "+state.currentUrl:"Removed bookmark.");
}

$("goBtn")?.addEventListener("click",()=>openPage($("address").value));
$("address").onkeydown=e=>{if(e.key==="Enter")openPage($("address").value)};
$("homeBrowse").onclick=()=>openPage($("homeInput").value);
$("homeInput").onkeydown=e=>{if(e.key==="Enter")openPage($("homeInput").value)};
document.querySelectorAll(".shortcuts button").forEach(b=>b.onclick=()=>openPage(b.dataset.url));
$("homeBtn").onclick=showHome;
$("newTab").onclick=showHome;
$("tabClose").onclick=showHome;
$("reloadBtn").onclick=()=>{if(state.currentUrl)openPage(state.currentUrl,false)};
$("backBtn").onclick=()=>{if(state.histIndex>0){state.histIndex--;openPage(state.history[state.histIndex],false)}};
$("forwardBtn").onclick=()=>{if(state.histIndex<state.history.length-1){state.histIndex++;openPage(state.history[state.histIndex],false)}};
$("starBtn").onclick=saveBookmark;
$("toolsMenuBtn").onclick=()=>{setTool("sourcePanel")};
$("consoleBtn")?.remove();
$("sourceBtn")?.remove();
$("linksBtn")?.remove();
document.querySelectorAll(".tool-tab").forEach(x=>x.onclick=()=>setTool(x.dataset.panel));
$("backToPage").onclick=showBrowser;
$("menuBtn").onclick=toggleMenu;
$("menuSource").onclick=()=>{closeMenu();setTool("sourcePanel")};
$("menuLinks").onclick=()=>{closeMenu();setTool("linkPanel")};
$("menuConsole").onclick=()=>{closeMenu();setTool("consolePanel")};
$("menuDev").onclick=()=>{closeMenu();setTool("devPanel")};
$("menuHome").onclick=()=>{closeMenu();showHome()};
$("devRefreshBtn").onclick=refreshDev;
$("devStopBtn").onclick=()=>{if(state.jobId)stopJob(state.jobId);else addLog("warn","No active crawl to stop.")};
$("devAutoRefresh").onchange=startDevAuto;
$("devNetFilter").onchange=e=>{state.devNetFilter=e.target.value;renderDevNet()};
$("devNetClear").onclick=()=>{state.netLog=[];renderDevNet()};
$("devCopyJsonBtn").onclick=async()=>{try{await navigator.clipboard.writeText($("devRawJson").textContent||"");addLog("info","Raw job JSON copied.")}catch(e){addLog("error","Copy failed: "+(e.message||e))}};
$("devExportBtn").onclick=()=>{if(!state.jobId){addLog("warn","No active crawl to export.");return}window.open(API+"/api/crawl/"+encodeURIComponent(state.jobId)+"/export","_blank")};
window.addEventListener("keydown",e=>{if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==="d"){e.preventDefault();setTool("devPanel")}});
if(location.hash==="#/dev")setTool("devPanel");
$("consoleFilter").onchange=renderConsole;
$("clearConsole").onclick=()=>{state.logs=[];state.remoteLogIds.clear();renderConsole();addLog("info","Console cleared.")};
$("copyConsole").onclick=async()=>{try{await navigator.clipboard.writeText(state.logs.map(x=>`[${new Date(x.time).toISOString()}] [${x.level.toUpperCase()}] ${x.message}`).join("\n"));addLog("info","Console copied.")}catch(e){addLog("error","Copy failed: "+(e.message||e))}};
$("pageFrame").addEventListener("load",()=>{$("pageState").textContent=state.currentUrl?hostOf(state.currentUrl):"Ready";setLoading(false)});
window.addEventListener("message",e=>{const d=e.data||{};if(d.type!=="veyra:navigate"||!d.url)return;const u=normalize(d.url);if(!u)return;state.currentUrl=u;$("address").value=u;$("tabTitle").textContent=hostOf(u);addLog("debug","Page navigation: "+u)});
window.addEventListener("error",e=>addLog("error",`Frontend error: ${e.message} @ ${e.filename||"inline"}:${e.lineno||"?"}`));
window.addEventListener("unhandledrejection",e=>addLog("error","Unhandled promise: "+(e.reason?.stack||e.reason||"")));
document.addEventListener("click",e=>{if(!$("menuPanel").contains(e.target)&&e.target!==$("menuBtn"))closeMenu()});
$("pageFrame").addEventListener("loadstart",()=>setLoading(true,60));
health();
addLog("info","Veyra Browse is ready. High-throughput background crawler enabled.");
