import "./style.css";
import { createWorld } from "./world";
import { initAudio } from "./synth";

const canvas = document.createElement("canvas");
document.getElementById("app")!.appendChild(canvas);

createWorld(canvas);

// Audio requires user gesture to start
document.addEventListener(
  "click",
  () => {
    void initAudio();
  },
  { once: true },
);
