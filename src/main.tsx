import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { CoralProvider, type CoralConfig } from "@coral-ai/react";
import "@coral-ai/markdown/styles";
import App from "./App";
import coralConfig from "../coral.config.json";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CoralProvider config={coralConfig as CoralConfig}>
      <App />
    </CoralProvider>
  </React.StrictMode>,
);
