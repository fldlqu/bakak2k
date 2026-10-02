// Bridge for running without a bundler: JSZip ships UMD only (dist/jszip.min.js).
// Importing it as a module executes the UMD side effect which sets window.JSZip;
// we then re-export it as the default ESM binding used by core/zip.js.
import '/node_modules/jszip/dist/jszip.min.js';
export default globalThis.JSZip;