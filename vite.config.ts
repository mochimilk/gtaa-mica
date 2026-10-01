import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import coral from "@coral-ai/react/vite";

export default defineConfig({
  plugins: [react(), coral()],
});
