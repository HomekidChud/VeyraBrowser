const runtimes = new Map();
const PREFIX = "veyra-extension-runtime:";
const MAX_STORAGE_VALUE = 64 * 1024;
const MAX_EXTENSION_STORAGE = 512 * 1024;

function bootstrapHtml() {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; style-src 'unsafe-inline'"><script>(()=>{
    const channel="veyra-extension-background-v2";let seq=0;const waiters=new Map();
    const call=(op,key,value)=>new Promise((resolve,reject)=>{const id=String(++seq);waiters.set(id,{resolve,reject});parent.postMessage({channel,id,op,key,value},"*");setTimeout(()=>{if(waiters.has(id)){waiters.delete(id);reject(new Error("Veyra storage request timed out"));}},5000)});
    Object.defineProperty(globalThis,"Veyra",{value:Object.freeze({storage:Object.freeze({get:key=>call("get",String(key)),set:(key,value)=>call("set",String(key),value),remove:key=>call("remove",String(key))})}),writable:false,configurable:false});
    addEventListener("message",event=>{if(event.source!==parent||!event.data||event.data.channel!==channel)return;const message=event.data;if(message.op==="start"&&typeof message.code==="string"){const script=document.createElement("script");script.textContent=message.code;document.documentElement.appendChild(script);script.remove();return}const waiter=waiters.get(String(message.id));if(waiter){waiters.delete(String(message.id));message.ok?waiter.resolve(message.value):waiter.reject(new Error(message.error||"Veyra storage request failed"))}});
    addEventListener("error",event=>parent.postMessage({channel,event:"error",message:String(event.message||"Background extension error").slice(0,500)},"*"));
    addEventListener("unhandledrejection",event=>parent.postMessage({channel,event:"error",message:String(event.reason?.message||event.reason||"Unhandled extension rejection").slice(0,500)},"*"));
    parent.postMessage({channel,event:"ready"},"*");
  })();</script>`;
}

function storageKey(id, key) {
  return `${PREFIX}${id}:${key}`;
}

function valueBytes(value) {
  try { return new Blob([JSON.stringify(value)]).size; } catch { return Infinity; }
}

export function startBackgroundExtension(extension, onError = () => {}) {
  if (!extension?.storeApproved || !extension.backgroundScript || !extension.permissions?.includes("background")) {
    throw new Error("A published, signed background extension with the background permission is required.");
  }
  stopBackgroundExtension(extension.id);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.title = `Veyra background extension: ${extension.name}`;
  iframe.style.cssText = "position:fixed!important;width:1px!important;height:1px!important;left:-10000px!important;top:-10000px!important;opacity:0!important;pointer-events:none!important";
  iframe.srcdoc = bootstrapHtml();
  const runtime = { iframe, name: String(extension.name || extension.id), permissions: new Set(extension.permissions || []), code: String(extension.backgroundScript), ready: false };
  const listener = event => {
    if (event.source !== iframe.contentWindow || event.data?.channel !== "veyra-extension-background-v2") return;
    const message = event.data;
    if (message.event === "ready") {
      runtime.ready = true;
      iframe.contentWindow.postMessage({ channel: "veyra-extension-background-v2", op: "start", code: runtime.code }, "*");
      return;
    }
    if (message.event === "error") { onError(`${runtime.name}: ${String(message.message || "script error").slice(0, 500)}`); return; }
    const respond = (ok, value, error = "") => iframe.contentWindow?.postMessage({ channel: "veyra-extension-background-v2", id: String(message.id || ""), ok, value, error }, "*");
    if (!runtime.permissions.has("storage")) { respond(false, null, "This extension did not request the storage permission."); return; }
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(String(message.key || ""))) { respond(false, null, "Invalid storage key."); return; }
    try {
      const key = storageKey(extension.id, String(message.key));
      if (message.op === "get") {
        const raw = localStorage.getItem(key); respond(true, raw === null ? null : JSON.parse(raw));
      } else if (message.op === "set") {
        const serialized = JSON.stringify(message.value);
        if (typeof serialized !== "string" || valueBytes(message.value) > MAX_STORAGE_VALUE) { respond(false, null, "Storage values must be JSON and are limited to 64 KB."); return; }
        const prefix = storageKey(extension.id, ""); let used = 0;
        for (let i = 0; i < localStorage.length; i++) { const storedKey = localStorage.key(i); if (storedKey?.startsWith(prefix)) used += (localStorage.getItem(storedKey) || "").length * 2; }
        const previous = localStorage.getItem(key) || "";
        if (used - previous.length * 2 + serialized.length * 2 > MAX_EXTENSION_STORAGE) { respond(false, null, "This extension has reached its 512 KB storage limit."); return; }
        localStorage.setItem(key, serialized); respond(true, true);
      } else if (message.op === "remove") {
        localStorage.removeItem(key); respond(true, true);
      } else respond(false, null, "Unsupported background API operation.");
    } catch (error) { respond(false, null, String(error.message || error).slice(0, 300)); }
  };
  runtime.listener = listener;
  runtime.timeout = setTimeout(() => { if (!runtime.ready) onError(`${runtime.name}: background sandbox did not initialize.`); }, 8000);
  window.addEventListener("message", listener);
  runtimes.set(extension.id, runtime);
  (document.body || document.documentElement).appendChild(iframe);
}

export function stopBackgroundExtension(id) {
  const runtime = runtimes.get(String(id));
  if (!runtime) return;
  clearTimeout(runtime.timeout);
  window.removeEventListener("message", runtime.listener);
  runtime.iframe.remove();
  runtimes.delete(String(id));
}

export function syncBackgroundExtensions(extensions, onError = () => {}) {
  const active = new Map((extensions || []).filter(extension => extension.enabled && extension.backgroundScript && extension.storeApproved).map(extension => [extension.id, extension]));
  for (const id of [...runtimes.keys()]) if (!active.has(id)) stopBackgroundExtension(id);
  for (const [id, extension] of active) {
    const current = runtimes.get(id);
    if (!current || current.code !== extension.backgroundScript) startBackgroundExtension(extension, onError);
  }
}
