import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5174,
        proxy: {
            "/planning-api": {
                target: process.env.PLANNING_API_URL ?? "http://localhost:5050",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/planning-api/, ""),
            },
        },
    },
});
