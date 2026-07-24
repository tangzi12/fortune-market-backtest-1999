import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../app/globals.css";
import TenbaggerM0Page from "../../app/tenbagger-m0/page";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root mount point");
}

createRoot(root).render(
  <StrictMode>
    <TenbaggerM0Page />
  </StrictMode>,
);
