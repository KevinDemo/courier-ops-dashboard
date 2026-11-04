import "./theme.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { apiSource } from "./data/apiSource";
import { createDemoSource } from "./data/demoSource";

declare const __DEMO__: boolean;

const source = __DEMO__ ? createDemoSource() : apiSource;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App source={source} />
  </StrictMode>,
);
