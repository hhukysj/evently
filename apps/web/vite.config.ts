import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(async ({ mode }) => {
  const environment = loadEnv(mode, repositoryRoot, ["PORT"]);
  const apiPort = Number(environment.PORT || 3001);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error("PORT must be a valid port number from 1 to 65535");
  }
  const { default: react } = await import("@vitejs/plugin-react");

  return {
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        mode === "production" ? "production" : "development",
      ),
    },
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
        },
      },
    },
  };
});
