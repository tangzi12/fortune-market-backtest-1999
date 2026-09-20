import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import "../../app/a-shares/a-shares.css";
import Home from "../../app/a-shares/page";
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<StrictMode><Home /></StrictMode>);
