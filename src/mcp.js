import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTools } from "./tools.js";

/** Builds an MCP server exposing the gate's four tools. One instance per connection. */
export function createMcpServer({ gate, config, log = () => {} }) {
  const server = new McpServer({ name: "agent-pay-gate", version: "0.1.0" });

  for (const tool of createTools({ gate, config, log })) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.shape }, async (args) => {
      const { ok, data } = await tool.call(args);
      return { isError: !ok, content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    });
  }

  return server;
}
