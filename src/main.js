import { createPlugin } from "./index.js";

const plugin = createPlugin();
Zotero.DeepRead = plugin;
globalThis.DeepReadZotero = plugin;
