import { createCoactWorker, createCoactDurableObject } from '../server/worker.js';
const options = { mode: 'demo' };
export const CoactRoom = createCoactDurableObject(options);
export default createCoactWorker(options);
