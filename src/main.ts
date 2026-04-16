import "./style.css";
import { createWorld } from "./world";
import { initAudio } from "./synth";
import { getState, load, save } from "./state";
import { setLocale } from "./i18n";

load();
setLocale(getState().locale);

const canvas = document.createElement("canvas");
document.getElementById("app")!.appendChild(canvas);

createWorld(canvas);

// Auto-save every 10 seconds
setInterval(save, 10_000);
// Save on page unload
window.addEventListener("beforeunload", save);

// Audio requires user gesture to start
document.addEventListener(
  "click",
  () => {
    void initAudio();
  },
  { once: true },
);
