import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../app/globals.css";
import V2MagnitudePage from "../../app/v2-magnitude/page";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root mount point");
}

createRoot(root).render(
  <StrictMode>
    <V2MagnitudePage />
  </StrictMode>,
);
