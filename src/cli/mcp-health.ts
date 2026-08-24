import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOOL_NAMES, createCodeIntelServer } from "../mcp/server.js";

/** A real in-memory MCP initialize/list-tools handshake; no child or network. */
export async function mcpHealthHandshake(): Promise<boolean> {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const server = createCodeIntelServer();
	const client = new Client({ name: "omcs-doctor", version: "0.1.0" });
	try {
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		const listed = await client.listTools();
		return listed.tools.length === TOOL_NAMES.length && TOOL_NAMES.every((name) => listed.tools.some((tool) => tool.name === name));
	} finally {
		await client.close().catch(() => undefined);
		await server.close().catch(() => undefined);
	}
}
