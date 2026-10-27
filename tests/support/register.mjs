// Installs the TypeScript-extension resolve hook for `npm test`.
import { register } from "node:module";

register("./ts-extension-resolver.mjs", import.meta.url);
