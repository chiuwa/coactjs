import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const entry = import.meta.resolve('coactjs');
const target = fileURLToPath(new URL('./work/assets/', import.meta.url));
await fs.mkdir(target, { recursive: true });
await fs.cp(fileURLToPath(new URL('../examples/basic/public/', entry)), target, { recursive: true });
await fs.cp(fileURLToPath(new URL('./', entry)), target + '/coact/src', { recursive: true });
await fs.cp(fileURLToPath(new URL('../assets/icons/', entry)), target + '/coact/icons', { recursive: true });
