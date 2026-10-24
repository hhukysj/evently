import process from "node:process";

process.env.NODE_ENV = "production";

const { build } = await import("vite");
await build();
