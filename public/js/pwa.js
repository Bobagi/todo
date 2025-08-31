// Versões exibidas no About
const APP_VERSION = "0.1.0";
const SW_VERSION = "v6";
window.__APP_VERSION__ = APP_VERSION;
window.__SW_VERSION__ = SW_VERSION;

let deferredPrompt;
const installBtn = document.getElementById("install-btn");

if (window.matchMedia("(display-mode: standalone)").matches) {
  if (installBtn) installBtn.style.display = "none";
}

window.addEventListener("beforeinstallprompt", (e) => {
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = "inline-block";
});

window.addEventListener("appinstalled", () => {
  if (installBtn) installBtn.style.display = "none";
});

installBtn?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  if (installBtn) installBtn.style.display = "none";
});

// SW refresh
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").then((reg) => {
    reg.update();
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      nw?.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) {
          nw.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
}
