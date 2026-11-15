import { createCoactWorker, createCoactDurableObject } from 'coactjs/worker';
const options = { mode: 'demo' };
export const CoactRoom = createCoactDurableObject(options);
export default createCoactWorker(options);
