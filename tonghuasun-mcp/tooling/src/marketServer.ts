import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configPath, endpointPath, productHome, readConfig, removeEndpointIfOwned, writePrivateJson } from "./config.js";
import { asServiceError } from "./errors.js";
import { createMarketHttpServer } from "./httpServer.js";
import { IfindClient } from "./ifindClient.js";
import { hasRefreshToken } from "./keychain.js";
import { MarketService } from "./marketService.js";
import { SecurityResolver } from "./securityResolver.js";
import { VERSION, type RuntimeEndpoint } from "./types.js";

const home = productHome();
const config = readConfig(home)!;
const currentFile = fileURLToPath(import.meta.url);
const widgetPath = resolve(dirname(currentFile), "..", "ui", "candle-chart.html");
const ifind = new IfindClient();
const resolver = new SecurityResolver(ifind);
const market = new MarketService(ifind, resolver);
const server = createMarketHttpServer({
  market,
  localAccessToken: config.localAccessToken,
  widgetPath,
  hasRefreshToken,
});

server.on("error", (error) => {
  const mapped = asServiceError(error);
  console.error(`[tonghuasun-agent] ${mapped.code}: ${mapped.message}`);
  process.exitCode = 1;
});

server.listen(config.preferredPort, "127.0.0.1", () => {
  const endpoint: RuntimeEndpoint = {
    schemaVersion: 1,
    baseUrl: `http://127.0.0.1:${config.preferredPort}`,
    mcpUrl: `http://127.0.0.1:${config.preferredPort}/mcp`,
    port: config.preferredPort,
    processId: process.pid,
    pluginVersion: VERSION,
    startedAtUtc: new Date().toISOString(),
  };
  writePrivateJson(endpointPath(home), endpoint);
  console.log(`[tonghuasun-agent] iFinD market service listening on 127.0.0.1:${config.preferredPort}`);
});

const shutdown = () => {
  server.close(() => {
    removeEndpointIfOwned(home, process.pid);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("uncaughtException", (error) => {
  const mapped = asServiceError(error);
  console.error(`[tonghuasun-agent] uncaught ${mapped.code}: ${mapped.message}`);
  shutdown();
});

console.log(`[tonghuasun-agent] config=${configPath(home)} version=${VERSION}`);
