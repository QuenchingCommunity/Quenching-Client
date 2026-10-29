// Preserve the old command while testing the unified resource format.
import { tsImport } from 'tsx/esm/api';
await tsImport('./test-resource-bundle.ts', import.meta.url);
