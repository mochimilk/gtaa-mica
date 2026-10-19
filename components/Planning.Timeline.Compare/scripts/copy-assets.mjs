import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await copyFile(
    new URL("../src/comparison.css", import.meta.url),
    new URL("../dist/comparison.css", import.meta.url),
);
