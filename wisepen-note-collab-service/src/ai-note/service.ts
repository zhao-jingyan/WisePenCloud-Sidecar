import { Room } from '../types';
import {
  findBlockLocation,
  getAiContentStore,
  insertEmptyBlock,
  readNativeBlocks,
} from './block-note-y-doc';
import {
  decodePatchContent,
  emptyNativeContent,
  isEditableBlockType,
  sanitizeBlockAttributes,
} from './patch-content-codec';
import {
  ApplyOperationResult,
  NoteSnapshot,
  PatchOperation,
  NoteApplyRequest,
  NoteApplyResponse,
  NoteReadRequest,
} from './types';
import { jsonEqual } from './value-utils';
import { createDeterministicBlockId, getReadableVersion } from './version';

export function readActiveRoom(
  room: Room,
  request: NoteReadRequest,
): NoteSnapshot {
  const version = getReadableVersion(room.yDoc);
  const blocks = readNativeBlocks(room.yDoc, request.includeAiContent !== false);
  return {
    resourceId: room.resourceId,
    version,
    blocks: applyScope(blocks, request.scope ?? { kind: 'whole_note' }),
  };
}

function findBlock(blocks: NoteSnapshot['blocks'], blockId: string): NoteSnapshot['blocks'][number] | undefined {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const nested = findBlock(block.children, blockId);
    if (nested) return nested;
  }
  return undefined;
}

function flattenBlocks(blocks: NoteSnapshot['blocks']): NoteSnapshot['blocks'] {
  return blocks.flatMap((block) => [{ ...block, children: [] }, ...flattenBlocks(block.children)]);
}

function applyScope(
  blocks: NoteSnapshot['blocks'],
  scope: NonNullable<NoteReadRequest['scope']>,
): NoteSnapshot['blocks'] {
  if (scope.kind === 'whole_note') return blocks;
  if (scope.kind === 'subtree') {
    const block = findBlock(blocks, scope.blockId);
    return block ? [block] : [];
  }
  if (scope.kind === 'blocks') {
    return scope.blockIds
      .map((blockId) => findBlock(blocks, blockId))
      .filter((block): block is NoteSnapshot['blocks'][number] => block !== undefined);
  }
  const flattened = flattenBlocks(blocks);
  const start = flattened.findIndex((block) => block.id === scope.startBlockId);
  const end = flattened.findIndex((block) => block.id === scope.endBlockId);
  return start < 0 || end < 0 || start > end ? [] : flattened.slice(start, end + 1);
}

function conflict(
  operation: PatchOperation,
  reason: ApplyOperationResult['reason'],
  blockId?: string,
): ApplyOperationResult {
  return { opId: operation.opId, status: 'conflict', reason, ...(blockId ? { blockId } : {}) };
}

function applyReplaceOrDelete(
  room: Room,
  operation: Extract<PatchOperation, { kind: 'replaceContent' | 'deleteBlock' }>,
): ApplyOperationResult {
  const location = findBlockLocation(room.yDoc, operation.blockId);
  if (!location) return conflict(operation, 'block_missing', operation.blockId);
  const type = location.block.nodeName;
  if (!isEditableBlockType(type)) {
    return conflict(operation, 'unsupported_type', operation.blockId);
  }
  const content =
    operation.kind === 'deleteBlock'
      ? emptyNativeContent(type)
      : decodePatchContent(type, operation.content);
  if (content === null) return conflict(operation, 'invalid_content', operation.blockId);

  const store = getAiContentStore(room.yDoc);
  if (store.has(operation.blockId) && jsonEqual(store.get(operation.blockId), content)) {
    return { opId: operation.opId, status: 'unchanged', blockId: operation.blockId };
  }
  store.set(operation.blockId, content);
  return { opId: operation.opId, status: 'applied', blockId: operation.blockId };
}

function applyInsert(
  room: Room,
  request: NoteApplyRequest,
  operation: Extract<PatchOperation, { kind: 'insertBlock' }>,
  lastAfterBlockByAnchor: Map<string, string>,
): ApplyOperationResult {
  const blockId = createDeterministicBlockId(room.resourceId, request.patchId, operation.opId);
  const existing = findBlockLocation(room.yDoc, blockId);
  const content = decodePatchContent(operation.block.type, operation.block.content);
  if (!isEditableBlockType(operation.block.type)) {
    return conflict(operation, 'unsupported_type', blockId);
  }
  if (content === null) return conflict(operation, 'invalid_content', blockId);
  const attributes = sanitizeBlockAttributes(operation.block.type, operation.block.attrs);
  if (attributes === null) return conflict(operation, 'invalid_content', blockId);

  const store = getAiContentStore(room.yDoc);
  if (existing) {
    if (existing.block.nodeName === operation.block.type && jsonEqual(store.get(blockId), content)) {
      if (operation.position === 'after') {
        lastAfterBlockByAnchor.set(operation.anchorBlockId, blockId);
      }
      return { opId: operation.opId, status: 'unchanged', blockId };
    }
    return conflict(operation, 'invalid_content', blockId);
  }

  const effectiveAnchorId =
    operation.position === 'after'
      ? (lastAfterBlockByAnchor.get(operation.anchorBlockId) ?? operation.anchorBlockId)
      : operation.anchorBlockId;
  const anchor = findBlockLocation(room.yDoc, effectiveAnchorId);
  if (!anchor) return conflict(operation, 'anchor_missing', blockId);
  insertEmptyBlock(
    room.yDoc,
    anchor,
    operation.position,
    blockId,
    operation.block.type,
    attributes,
  );
  store.set(blockId, content);
  if (operation.position === 'after') {
    lastAfterBlockByAnchor.set(operation.anchorBlockId, blockId);
  }
  return { opId: operation.opId, status: 'applied', blockId };
}

export function applyPatchToActiveRoom(
  room: Room,
  request: NoteApplyRequest,
  userId: string,
): NoteApplyResponse {
  const currentVersion = getReadableVersion(room.yDoc);
  const results: ApplyOperationResult[] = [];
  const lastAfterBlockByAnchor = new Map<string, string>();

  room.yDoc.transact(() => {
    for (const operation of request.operations) {
      if (operation.kind === 'insertBlock') {
        results.push(applyInsert(room, request, operation, lastAfterBlockByAnchor));
      } else {
        results.push(applyReplaceOrDelete(room, operation));
      }
    }
  }, { operationType: 'AI_DIFF', source: 'ai-note-internal', userId });

  return {
    resourceId: room.resourceId,
    requestedVersion: request.version,
    currentVersion,
    resultVersion: getReadableVersion(room.yDoc),
    modified: request.version !== currentVersion,
    results,
  };
}
