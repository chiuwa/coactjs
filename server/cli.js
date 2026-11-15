#!/usr/bin/env node
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { port: { type: 'string', short: 'p', default: '4174' }, host: { type: 'string', default: '127.0.0.1' }, help: { type: 'boolean', short: 'h' } } });
if (values.help) {
  console.log('Coact.js local example\n\ncoactjs [--port 4174] [--host 127.0.0.1]\n\nRequires Node.js 20+ and the optional ws server peer.\nAnonymous demo; use the server API with auth hooks for private rooms.');
} else {
  try {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer between 0 and 65535.');
    const { startBasicExample } = await import('../examples/basic/server.js');
    const app = await startBasicExample({ port, host: values.host });
    console.log(`Coact.js local example: http://${values.host}:${app.port}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.stop(); process.exit(0); });
  } catch (error) {
    console.error(error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes("'ws'") ? 'Install the optional server peer: npm install coactjs ws' : error.message);
    process.exitCode = 1;
  }
}
