import { fileURLToPath } from 'node:url';
import { createCoactServer } from '../../server/index.js';
import { staticFiles } from '../../server/static.js';
export async function startBasicExample(options = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const app = createCoactServer({ host: '127.0.0.1', port: 4174, ...options,
    requestHandler: staticFiles({ '/': fileURLToPath(new URL('./public/', import.meta.url)), '/coact/src/': root + 'src', '/coact/icons/': root + 'assets/icons' })
  });
  const address = await app.start();
  return { ...app, ...address };
}
