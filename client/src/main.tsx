import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const mountNode = document.querySelector<HTMLDivElement>("#app");
if (!mountNode) {
  throw new Error("mount_node_not_found");
}

createRoot(mountNode).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

