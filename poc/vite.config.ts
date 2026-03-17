import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  envDir: "..",
  server: {
    port: 3000,
  },
});
