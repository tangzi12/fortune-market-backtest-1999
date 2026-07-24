import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../app/globals.css";
import TenbaggerMainGodPage from "../../app/tenbagger-main-god/page";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root mount point");
}

createRoot(root).render(
  <StrictMode>
    <TenbaggerMainGodPage />
  </StrictMode>,
);
