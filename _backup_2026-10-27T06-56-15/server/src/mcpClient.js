import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "./config.js";

/**
 * Spawns the local MCP server (stdio) for ONE run, scoped to ONE project folder.
 * Only PATH-like safe variables plus STUDIO_STORAGE_DIR and the image-provider settings are passed to the child;
 * the Anthropic key and JWT secret never reach the MCP process.
 */
const IMAGE_ENV = ["OPENAI_API_KEY", "GEMINI_API_KEY", "OPENAI_IMAGE_MODEL", "GEMINI_IMAGE_MODEL", "OPENAI_BASE_URL", "GEMINI_BASE_URL", "SOFFICE_PATH"];
const imageEnv = () => Object.fromEntries(IMAGE_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

export async function connectMcp(storageDir) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [config.mcpEntry],
    env: { ...imageEnv(), STUDIO_STORAGE_DIR: storageDir },
  });
  const client = new Client({ name: "studio-api", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return {
    tools,
    async call(name, args) {
      const r = await client.callTool({ name, arguments: args || {} });
      const text = (r.content || []).map((c) => (c.type === "text" ? c.text : "")).join("\n");
      return { text, isError: !!r.isError };
    },
    close: () => client.close().catch(() => {}),
  };
}
