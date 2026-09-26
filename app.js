const API="https://veyraserver-xscy.onrender.com";
const state={
  jobId:null,currentUrl:"",history:[],histIndex:-1,poll:null,
  logs:[],remoteLogIds:new Set(),resources:[],selected:-1,links:[],
  bookmarked:new Set(JSON.parse(localStorage.getItem("veyra-bookmarks")||"[]"))
};
const $=id=>document.getElementById(id);

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
  ["sourcePanel","linkPanel","consolePanel"].forEach(id=>$(id).classList.toggle("hidden",id!==panel));
  if(panel==="sourcePanel")renderResources();
  if(panel==="linkPanel")loadLinks();
  if(panel==="consolePanel")renderConsole();
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
    const c=b.counts||{};
    $("crawlSummary").textContent=`Crawler: ${c.processed||0} processed · ${c.htmlPages||0} HTML · ${c.css||0} CSS · ${c.js||0} JS · ${c.links||0} links`;
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

$("goBtn").onclick=()=>openPage($("address").value);
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
$("menuHome").onclick=()=>{closeMenu();showHome()};
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
addLog("info","Veyra Browse is ready.");
