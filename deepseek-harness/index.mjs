import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";

export const name = "tonghuasun-agent";
export const inject = mcpClient.inject;

export async function apply(ctx) {
  const proxyPath = fileURLToPath(new URL("./scripts/tonghuasun-mcp-proxy.mjs", import.meta.url));
  const explicitEnvironment = Object.fromEntries(
    ["HOME", "TONGHUASUN_AGENT_HOME", "TONGHUASUN_CODEX_HOME"]
      .map((key) => [key, process.env[key]])
      .filter((entry) => typeof entry[1] === "string" && entry[1].length > 0)
  );

  await mcpClient.apply(ctx, {
    transport: "stdio",
    serverName: "tonghuasun",
    command: process.execPath,
    args: [proxyPath],
    env: explicitEnvironment,
    cwd: dirname(proxyPath),
    toolCallTimeoutMs: 120_000,
    failOnStartupError: false,
    reconnect: {
      enabled: true,
      initialDelayMs: 500,
      maxDelayMs: 30_000,
      maxAttempts: 10
    }
  });
}
