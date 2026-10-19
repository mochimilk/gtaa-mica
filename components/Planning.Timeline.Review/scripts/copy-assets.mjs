import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await copyFile(
    new URL("../src/review.css", import.meta.url),
    new URL("../dist/review.css", import.meta.url),
);
