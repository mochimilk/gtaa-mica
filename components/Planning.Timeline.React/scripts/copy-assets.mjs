import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await copyFile(
    new URL("../src/timeline.css", import.meta.url),
    new URL("../dist/timeline.css", import.meta.url),
);
