import { createHash } from 'crypto';
import * as Y from 'yjs';

export function getReadableVersion(doc: Y.Doc): string {
  const encodedState = Y.encodeStateAsUpdate(doc);
  const digest = createHash('sha256').update(encodedState).digest('base64url');
  return `yjs-v1:${digest}`;
}

export function createDeterministicBlockId(
  resourceId: string,
  patchId: string,
  opId: string,
): string {
  const digest = createHash('sha256')
    .update(resourceId)
    .update('\0')
    .update(patchId)
    .update('\0')
    .update(opId)
    .digest('hex')
    .slice(0, 24);
  return `ai_${digest}`;
}
