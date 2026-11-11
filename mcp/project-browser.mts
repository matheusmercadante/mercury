// THE WORKER'S END OF ITS PROJECT'S BROWSER. It holds nothing and decides
// nothing: each call goes to the project's host (main/project-browser/host.mts)
// on the socket the app named, with the thread's name, and the host's answer
// comes back. Which sites open and which tools exist is the host's to say, from
// what the app wrote, so nothing a worker can set here widens either.
//
// Node's own modules only, so it starts on the app's own binary with no install.
import readline from 'node:readline';
import { askHost } from '../main/project-browser/place.mts';

const OFFLINE_TOOL = 'browser_status';
const LIST_MS = 30_000;
// Above the host's own limit on a call, so the host's words are the ones heard.
const CALL_MS = 4 * 60_000;

const { PROJECT_BROWSER_SOCK: SOCK, PROJECT_BROWSER_THREAD: THREAD } = process.env;

const OFFLINE = 'This project\'s browser is not running, so nothing was done. It starts with the app, when a thread of the project starts. If it is still not there on the next try, tell the owner.';

interface ToolResult { isError?: boolean; content: { type: string; text?: string }[] }
interface McpTool { name: string; description?: string; inputSchema: Record<string, unknown> }
interface RpcRequest { id?: string | number; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } }

const failed = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] });
const send = (msg: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(msg)}\n`);

let lastTools: McpTool[] | null = null;

/** The host may be a moment from listening when a run starts. */
async function toolsList(): Promise<{ tools: McpTool[] }> {
  for (let tries = 0; SOCK && tries < 5; tries += 1) {
    const got = await askHost<{ tools?: McpTool[] }>(SOCK, { method: 'tools/list' }, { ms: LIST_MS });
    if (got?.tools) { lastTools = got.tools; return { tools: lastTools }; }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (lastTools) return { tools: lastTools };
  // Something to call, or the agent could only guess why the browser is missing.
  return { tools: [{ name: OFFLINE_TOOL, description: 'Says why this project\'s browser cannot be reached right now.', inputSchema: { type: 'object', properties: {} } }] };
}

async function toolsCall(params: RpcRequest['params']): Promise<ToolResult> {
  if (!SOCK || !THREAD) return failed(OFFLINE);
  if (params?.name === OFFLINE_TOOL) {
    const got = await askHost(SOCK, { method: 'status' }, { ms: LIST_MS });
    return got ? { content: [{ type: 'text', text: 'This project\'s browser can be reached again.' }] } : failed(OFFLINE);
  }
  const got = await askHost<ToolResult>(SOCK, { method: 'tools/call', thread: THREAD, params: { name: params?.name, arguments: params?.arguments ?? {} } }, { ms: CALL_MS });
  return got ?? failed(OFFLINE);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg: RpcRequest;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'This project\'s browser', version: '1.0.0' } } });
  } else if (method === 'ping') send({ jsonrpc: '2.0', id, result: {} });
  else if (method === 'tools/list') send({ jsonrpc: '2.0', id, result: await toolsList() });
  else if (method === 'tools/call') send({ jsonrpc: '2.0', id, result: await toolsCall(params) });
  else send({ jsonrpc: '2.0', id, error: { code: -32601, message: `${method} is not offered` } });
});
rl.on('close', () => process.exit(0));
