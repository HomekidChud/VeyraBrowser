import { directSiteUrl } from "./direct-url.js";

const form = document.getElementById("open-site");
const address = document.getElementById("site-address");
const error = document.getElementById("site-error");

address.addEventListener("input", () => {
  address.removeAttribute("aria-invalid");
  error.textContent = "";
});

form.addEventListener("submit", event => {
  event.preventDefault();
  const target = directSiteUrl(address.value);
  if (!target) {
    address.setAttribute("aria-invalid", "true");
    error.textContent = "Enter a full https:// address without a username or password.";
    address.focus();
    return;
  }
  window.open(target, "_blank", "noopener,noreferrer");
});
