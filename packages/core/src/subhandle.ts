// subhandle.ts
//
// Public import path for SubHandle. Since PR-10 (D4) the class pair
// `Handle`/`SubHandle` lives in `handle.ts`: `SubHandle extends Handle`,
// and a static cross-file import of the subclass would create an ESM
// module cycle that crashes at import time depending on the graph root
// (reproduced: "Cannot access 'Handle' before initialization"). The
// pre-PR-10 dynamic `import()` dodge is gone; co-location keeps the
// module graph acyclic and 100% static.
//
// This facade re-exports the class and its metadata type unchanged, so
// `import { SubHandle } from '@me2em/core'` and internal imports of
// `./subhandle.js` keep working exactly as before.

export { SubHandle, type SubHandleMetadata } from './handle.js';
