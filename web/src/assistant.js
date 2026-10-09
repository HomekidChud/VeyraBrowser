import { $, esc, api, auth, hooks, toast } from "./core.js?v=8.28.17-session-resume-userscripts";

let lastTask = null;

function list(items, empty = "None") {
  return Array.isArray(items) && items.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p class="muted small">${esc(empty)}</p>`;
}

function renderResult(result) {
  if (!result) return `<div class="assistant-empty"><b>Ask Veyra Assistant anything you want to plan, explain, or review.</b><span>It uses two independent analysts and a verifier. It cannot browse pages or read your session unless you explicitly paste approved text below.</span></div>`;
  const workflow = result.workflow?.agents || [];
  return `<article class="assistant-result" aria-live="polite">
    <header><div><span class="pill accent">${esc(result.evidenceStatus || "general-guidance")}</span><h2>Veyra Assistant</h2></div><span class="muted small">Task ${esc(String(result.taskId || "").slice(0, 8))}</span></header>
    <div class="assistant-answer">${esc(result.answer || "")}</div>
    <div class="assistant-result-grid">
      <section><h3>Caveats</h3>${list(result.caveats, "No additional caveats returned.")}</section>
      <section><h3>Suggested next steps</h3>${list(result.nextSteps, "No next steps returned.")}</section>
    </div>
    <footer><span class="muted small">${result.context?.included ? "Only the page text you approved was sent to the configured provider." : "No browser page text was sent."}</span><div class="assistant-agents">${workflow.map(agent => `<span class="pill ok">${esc(agent.role)} · ${esc(agent.status)}</span>`).join("")}</div></footer>
  </article>`;
}

function bindFeedback(box) {
  const form = box.querySelector("#assistantFeedback");
  if (!form || !lastTask || !auth.user) return;
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const output = form.querySelector("[data-feedback-result]");
    const data = new FormData(form);
    button.disabled = true;
    try {
      const response = await api("/api/assistant/feedback", {
        json: {
          taskId: lastTask.taskId,
          question: lastTask.question,
          rating: data.get("rating"),
          note: data.get("note"),
          trainingConsent: data.get("trainingConsent") === "on"
        },
        timeoutMs: 10000
      });
      output.textContent = response.feedback?.stored ? "Thank you. Your opt-in feedback is queued for human review only." : (response.feedback?.reason || "Feedback saved without training data.");
      form.reset();
    } catch (error) {
      output.textContent = error.message;
      output.className = "form-error";
    } finally { button.disabled = false; }
  };
}

function renderPanel(status = null) {
  const box = $("assistantPanel");
  if (!box) return;
  if (!auth.user) {
    box.innerHTML = `<div class="assistant-empty"><b>Veyra Assistant is private to your signed-in account.</b><span>Sign in before submitting a question. Page content is never collected automatically.</span><button class="btn primary" data-auth="login">Sign in</button></div>`;
    return;
  }
  if (status && !status.available) {
    box.innerHTML = `<div class="assistant-empty"><b>Veyra Assistant is not configured on this server.</b><span>Set the server-side AI provider variables before requests can run. No prompt or browsing data has been sent.</span></div>`;
    return;
  }
  box.innerHTML = `<div class="assistant-layout">
    <form class="assistant-form" id="assistantForm">
      <div><span class="kicker">Consent-aware agent workflow</span><h1>Veyra Assistant</h1><p class="muted">Two analysts independently work on your question, then a verifier reconciles the result. It does not run browser actions, browse the web, or read page data by default.</p></div>
      <label class="field"><span>What would you like help with?</span><textarea class="input" name="question" rows="5" maxlength="4000" placeholder="For example: Turn these requirements into a safe implementation plan." required></textarea></label>
      <details class="assistant-context"><summary>Optional page context</summary><p>Paste only text you want sent to the configured AI provider. Do not include passwords, payment details, or private data you do not want processed externally.</p><label class="field"><span>Page URL (optional)</span><input class="input" name="contextUrl" inputmode="url" maxlength="1000" placeholder="https://example.com/article"></label><label class="field"><span>Page title (optional)</span><input class="input" name="contextTitle" maxlength="300" placeholder="Article title"></label><label class="field"><span>Selected page text (optional)</span><textarea class="input" name="selectedText" rows="6" maxlength="12000" placeholder="Paste only the relevant text."></textarea></label><label class="switch-row"><input type="checkbox" class="switch" name="sendPageContext"><span>I approve sending this pasted page context to the configured AI provider.</span></label></details>
      <div class="assistant-form-actions"><button class="btn primary" type="submit">Ask Veyra Assistant</button><span class="muted small">${esc(status?.contextPolicy || "Only explicitly approved text is shared.")}</span></div>
      <p class="form-error" id="assistantError" aria-live="polite"></p>
    </form>
    <div class="assistant-output" id="assistantOutput">${renderResult(lastTask?.result)}</div>
  </div>
  ${lastTask ? `<form class="assistant-feedback" id="assistantFeedback"><div><b>Was this useful?</b><p class="muted small">Feedback is not used for automatic model training.</p></div><select class="input" name="rating"><option value="helpful">Helpful</option><option value="not_helpful">Not helpful</option></select><input class="input" name="note" maxlength="1000" placeholder="Optional feedback"><label class="switch-row"><input type="checkbox" class="switch" name="trainingConsent"><span>Allow this question and feedback into a time-limited human review queue.</span></label><button class="btn ghost" type="submit">Send feedback</button><span class="muted small" data-feedback-result></span></form>` : ""}`;

  const form = $("assistantForm");
  form.onsubmit = async event => {
    event.preventDefault();
    const data = new FormData(form);
    const hasContext = ["contextUrl", "contextTitle", "selectedText"].some(name => String(data.get(name) || "").trim());
    const consent = data.get("sendPageContext") === "on";
    const error = $("assistantError");
    if (hasContext && !consent) {
      error.textContent = "Approve page-context sharing before submitting pasted page text.";
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    error.textContent = "";
    $("assistantOutput").innerHTML = `<div class="assistant-empty"><b>Independent agents are reviewing your request.</b><span>Veyra will show only the verified answer, not hidden reasoning.</span></div>`;
    try {
      const question = String(data.get("question") || "").trim();
      const response = await api("/api/assistant/ask", {
        json: {
          question,
          context: { url: data.get("contextUrl"), title: data.get("contextTitle"), selectedText: data.get("selectedText") },
          consent: { sendPageContext: consent }
        },
        timeoutMs: 65000
      });
      lastTask = { taskId: response.taskId, question, result: response };
      renderPanel(status);
    } catch (requestError) {
      error.textContent = requestError.message;
      $("assistantOutput").innerHTML = renderResult(lastTask?.result);
    } finally { button.disabled = false; }
  };
  bindFeedback(box);
}

export async function renderAssistant() {
  renderPanel();
  try {
    const status = await api("/api/assistant/status", { timeoutMs: 8000 });
    renderPanel(status);
  } catch (error) {
    const box = $("assistantPanel");
    if (box) box.innerHTML = `<div class="assistant-empty"><b>Veyra Assistant status is unavailable.</b><span>${esc(error.message)}</span></div>`;
  }
}

export function initAssistant() {
  hooks.renderAssistant = renderAssistant;
}
