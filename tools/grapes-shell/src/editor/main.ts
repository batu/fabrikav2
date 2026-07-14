import { mountConstrainedEditor } from "./app.ts";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing constrained editor root.");

mountConstrainedEditor(root);
