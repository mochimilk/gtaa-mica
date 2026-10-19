import React from "react";
import { createRoot } from "react-dom/client";
import "@planning/timeline-compare/styles.css";
import "@planning/timeline-react/styles.css";
import "@planning/timeline-review/styles.css";
import "./styles.css";
import { App } from "./App";

const root = document.getElementById("root");
if (root === null) {
    throw new Error("Demo root element is missing.");
}

createRoot(root).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
