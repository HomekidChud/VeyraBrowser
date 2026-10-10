import { $, esc, api, auth, hooks, toast } from "./core.js?v=8.28.17-session-resume-userscripts";

let lastTask = null;

function list(items, empty = "None") {
  return Array.isArray(items) && items.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p class="muted small">${esc(empty)}</p>`;
}

function renderResult(result) {
  if (!result) return `<div class="assistant-empty"><b>Veyra Assistance is a local training prototype.</b><span>It can report on the cooperative maze-training system. It has no general-purpose language model, does not use an external API key, and is not AGI.</span></div>`;
  const workflow = result.workflow?.agents || [];
  return `<article class="assistant-result" aria-live="polite">
    <header><div><span class="pill accent">${esc(result.evidenceStatus || "general-guidance")}</span><h2>Veyra Assistant</h2></div><span class="muted small">Task ${esc(String(result.taskId || "").slice(0, 8))}</span></header>
    <div class="assistant-answer">${esc(result.answer || "")}</div>
    <div class="assistant-result-grid">
      <section><h3>Caveats</h3>${list(result.caveats, "No additional caveats returned.")}</section>
      <section><h3>Suggested next steps</h3>${list(result.nextSteps, "No next steps returned.")}</section>
    </div>
    <footer><span class="muted small">Processed locally · no page access · no external model API</span><div class="assistant-agents">${workflow.map(agent => `<span class="pill ok">${esc(agent.role)} · ${esc(agent.status)}</span>`).join("")}</div></footer>
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
  box.innerHTML = `<div class="assistant-layout">
    <form class="assistant-form" id="assistantForm">
      <div><span class="kicker">Local cooperative agents · no API key</span><h1>Veyra Assistance</h1><p class="muted">A bounded local prototype. Scout, Mapper, and Coordinator train together in a generated maze. Questions about that training are answered from server state. General-purpose reasoning is not implemented yet; this system is not AGI.</p></div>
      <label class="field"><span>Ask about agent training</span><textarea class="input" name="question" rows="5" maxlength="4000" placeholder="How are the agents doing in the maze?" required></textarea></label>
      <div class="assistant-form-actions"><button class="btn primary" type="submit">Ask Veyra Assistance</button><span class="muted small">Processed locally; no external provider, API key, or browser context.</span></div>
      <p class="form-error" id="assistantError" aria-live="polite"></p>
    </form>
    <div class="assistant-output" id="assistantOutput">${renderResult(lastTask?.result)}</div>
  </div>
  ${lastTask ? `<form class="assistant-feedback" id="assistantFeedback"><div><b>Was this useful?</b><p class="muted small">Feedback is not used for automatic model training.</p></div><select class="input" name="rating"><option value="helpful">Helpful</option><option value="not_helpful">Not helpful</option></select><input class="input" name="note" maxlength="1000" placeholder="Optional feedback"><label class="switch-row"><input type="checkbox" class="switch" name="trainingConsent"><span>Allow this question and feedback into a time-limited human review queue.</span></label><button class="btn ghost" type="submit">Send feedback</button><span class="muted small" data-feedback-result></span></form>` : ""}`;

  const form = $("assistantForm");
  form.onsubmit = async event => {
    event.preventDefault();
    const data = new FormData(form);
    const error = $("assistantError");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    error.textContent = "";
      $("assistantOutput").innerHTML = `<div class="assistant-empty"><b>Local Veyra agents are checking training status.</b><span>No external model provider is being called.</span></div>`;
    try {
      const question = String(data.get("question") || "").trim();
      const response = await api("/api/assistant/ask", {
        json: {
          question,
          context: {},
          consent: { sendPageContext: false }
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
