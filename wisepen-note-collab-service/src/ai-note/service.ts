import { Room } from '../types';
import {
  findBlockLocation,
  getAiContentStore,
  insertEmptyBlock,
  readNativeBlocks,
} from './block-note-y-doc';
import {
  decodeEasyContent,
  emptyNativeContent,
  encodeEasyDocument,
  isEditableBlockType,
  sanitizeBlockAttributes,
} from './easy-codec';
import {
  ApplyOperationResult,
  EasyNoteDocument,
  EasyPatchOperation,
  NoteApplyRequest,
  NoteApplyResponse,
  NoteReadRequest,
} from './types';
import { jsonEqual } from './value-utils';
import { createDeterministicBlockId, getReadableVersion } from './version';

export function readActiveRoom(
  room: Room,
  request: NoteReadRequest,
): EasyNoteDocument {
  const version = getReadableVersion(room.yDoc);
  const nativeBlocks = readNativeBlocks(room.yDoc, request.includeAiContent !== false);
  return encodeEasyDocument(
    room.resourceId,
    version,
    nativeBlocks,
    request.scope ?? { kind: 'whole_note' },
  );
}

function conflict(
  operation: EasyPatchOperation,
  reason: ApplyOperationResult['reason'],
  blockId?: string,
): ApplyOperationResult {
  return { opId: operation.opId, status: 'conflict', reason, ...(blockId ? { blockId } : {}) };
}

function applyReplaceOrDelete(
  room: Room,
  operation: Extract<EasyPatchOperation, { kind: 'replaceContent' | 'deleteBlock' }>,
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
      : decodeEasyContent(type, operation.content);
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
  operation: Extract<EasyPatchOperation, { kind: 'insertBlock' }>,
  lastAfterBlockByAnchor: Map<string, string>,
): ApplyOperationResult {
  const blockId = createDeterministicBlockId(room.resourceId, request.patchId, operation.opId);
  const existing = findBlockLocation(room.yDoc, blockId);
  const content = decodeEasyContent(operation.block.type, operation.block.content);
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
