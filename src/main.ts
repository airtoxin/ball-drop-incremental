import "./style.css";
import { createWorld } from "./world";
import { initAudio } from "./synth";
import { getState, load, save } from "./state";
import { setLocale, t } from "./i18n";

load();
setLocale(getState().locale);

const canvas = document.createElement("canvas");
document.getElementById("app")!.appendChild(canvas);

// Save on page unload
window.addEventListener("beforeunload", save);

// Start overlay — blocks world/auto-drop from running until user gesture.
// Also satisfies the browser autoplay policy for Tone.js.
const overlay = document.createElement("div");
overlay.id = "start-overlay";
overlay.textContent = t("clickToStart");
document.body.appendChild(overlay);

overlay.addEventListener(
  "click",
  () => {
    void initAudio();
    createWorld(canvas);
    setInterval(save, 10_000);
    overlay.classList.add("hiding");
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
  },
  { once: true },
);
