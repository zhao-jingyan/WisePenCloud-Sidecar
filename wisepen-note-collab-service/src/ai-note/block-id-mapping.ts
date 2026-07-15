import * as Y from 'yjs';
import {
  EasyBlock,
  EasyNoteDocument,
  EasyPatchOperation,
  NoteApplyRequest,
  NoteApplyResponse,
  NoteReadRequest,
  NoteReadScope,
} from './types';

const MAX_MAPPINGS_PER_DOCUMENT = 32;
const PUBLIC_BLOCK_ID_PATTERN = /^p_\d{3,}$/;

interface BlockIdMapping {
  version: string;
  internalToPublic: Map<string, string>;
  publicToInternal: Map<string, string>;
}

interface DocumentMappingCache {
  byVersion: Map<string, BlockIdMapping>;
  latestVersion?: string;
}

export class BlockIdMappingError extends Error {
  constructor() {
    super('BLOCK_ID_MAPPING_NOT_FOUND');
    this.name = 'BlockIdMappingError';
  }
}

const mappingCaches = new WeakMap<Y.Doc, DocumentMappingCache>();

function visitBlocks(blocks: EasyBlock[], visitor: (block: EasyBlock) => void): void {
  for (const block of blocks) {
    visitor(block);
    visitBlocks(block.children, visitor);
  }
}

function createMapping(document: EasyNoteDocument): BlockIdMapping {
  const internalToPublic = new Map<string, string>();
  const publicToInternal = new Map<string, string>();
  visitBlocks(document.blocks, (block) => {
    if (internalToPublic.has(block.id)) return;
    const publicId = `p_${String(internalToPublic.size + 1).padStart(3, '0')}`;
    internalToPublic.set(block.id, publicId);
    publicToInternal.set(publicId, block.id);
  });
  return { version: document.version, internalToPublic, publicToInternal };
}

function cacheFor(doc: Y.Doc): DocumentMappingCache {
  let cache = mappingCaches.get(doc);
  if (!cache) {
    cache = { byVersion: new Map() };
    mappingCaches.set(doc, cache);
  }
  return cache;
}

function findMapping(doc: Y.Doc, version?: string): BlockIdMapping | undefined {
  const cache = mappingCaches.get(doc);
  if (!cache) return undefined;
  const targetVersion = version ?? cache.latestVersion;
  if (!targetVersion) return undefined;
  const mapping = cache.byVersion.get(targetVersion);
  if (!mapping) return undefined;
  cache.byVersion.delete(targetVersion);
  cache.byVersion.set(targetVersion, mapping);
  return mapping;
}

export function rememberBlockIdMapping(
  doc: Y.Doc,
  document: EasyNoteDocument,
): BlockIdMapping {
  const cache = cacheFor(doc);
  const existing = cache.byVersion.get(document.version);
  if (existing) {
    cache.byVersion.delete(document.version);
    cache.byVersion.set(document.version, existing);
    cache.latestVersion = document.version;
    return existing;
  }

  const mapping = createMapping(document);
  cache.byVersion.set(document.version, mapping);
  cache.latestVersion = document.version;
  while (cache.byVersion.size > MAX_MAPPINGS_PER_DOCUMENT) {
    const oldestVersion = cache.byVersion.keys().next().value as string | undefined;
    if (!oldestVersion) break;
    cache.byVersion.delete(oldestVersion);
  }
  return mapping;
}

function publicizeBlocks(blocks: EasyBlock[], mapping: BlockIdMapping): EasyBlock[] {
  return blocks.map((block) => {
    const publicId = mapping.internalToPublic.get(block.id);
    if (!publicId) throw new BlockIdMappingError();
    return {
      ...block,
      id: publicId,
      children: publicizeBlocks(block.children, mapping),
    };
  });
}

export function publicizeDocumentBlockIds(
  document: EasyNoteDocument,
  mapping: BlockIdMapping,
): EasyNoteDocument {
  return { ...document, blocks: publicizeBlocks(document.blocks, mapping) };
}

function resolvePublicId(mapping: BlockIdMapping, blockId: string): string {
  if (!PUBLIC_BLOCK_ID_PATTERN.test(blockId)) throw new BlockIdMappingError();
  const internalId = mapping.publicToInternal.get(blockId);
  if (!internalId) throw new BlockIdMappingError();
  return internalId;
}

function scopeBlockIds(scope: NoteReadScope): string[] {
  if (scope.kind === 'whole_note') return [];
  if (scope.kind === 'blocks') return scope.blockIds;
  if (scope.kind === 'subtree') return [scope.blockId];
  return [scope.startBlockId, scope.endBlockId];
}

function resolveScope(scope: NoteReadScope, mapping: BlockIdMapping): NoteReadScope {
  if (scope.kind === 'whole_note') return scope;
  if (scope.kind === 'blocks') {
    return { ...scope, blockIds: scope.blockIds.map((id) => resolvePublicId(mapping, id)) };
  }
  if (scope.kind === 'subtree') {
    return { ...scope, blockId: resolvePublicId(mapping, scope.blockId) };
  }
  return {
    ...scope,
    startBlockId: resolvePublicId(mapping, scope.startBlockId),
    endBlockId: resolvePublicId(mapping, scope.endBlockId),
  };
}

export function resolveReadRequestBlockIds(
  doc: Y.Doc,
  request: NoteReadRequest,
): NoteReadRequest {
  if (!request.scope) return request;
  const ids = scopeBlockIds(request.scope);
  if (ids.length === 0) return request;
  const mapping = findMapping(doc, request.version);
  if (!mapping) throw new BlockIdMappingError();
  return { ...request, scope: resolveScope(request.scope, mapping) };
}

function operationBlockIds(operation: EasyPatchOperation): string[] {
  return operation.kind === 'insertBlock'
    ? [operation.anchorBlockId]
    : [operation.blockId];
}

function resolveOperation(
  operation: EasyPatchOperation,
  mapping: BlockIdMapping,
): EasyPatchOperation {
  if (operation.kind === 'insertBlock') {
    return {
      ...operation,
      anchorBlockId: resolvePublicId(mapping, operation.anchorBlockId),
    };
  }
  return { ...operation, blockId: resolvePublicId(mapping, operation.blockId) };
}

export function resolveApplyRequestBlockIds(
  doc: Y.Doc,
  request: NoteApplyRequest,
): NoteApplyRequest {
  const ids = request.operations.flatMap(operationBlockIds);
  if (ids.some((id) => !PUBLIC_BLOCK_ID_PATTERN.test(id))) {
    throw new BlockIdMappingError();
  }
  const mapping = findMapping(doc, request.version);
  if (!mapping) throw new BlockIdMappingError();
  return {
    ...request,
    operations: request.operations.map((operation) => resolveOperation(operation, mapping)),
  };
}

export function publicizeApplyResponseBlockIds(
  response: NoteApplyResponse,
  mapping: BlockIdMapping,
): NoteApplyResponse {
  return {
    ...response,
    results: response.results.map((result) => {
      if (!result.blockId) return result;
      const publicId = mapping.internalToPublic.get(result.blockId);
      if (!publicId) {
        const { blockId: _blockId, ...withoutBlockId } = result;
        return withoutBlockId;
      }
      return { ...result, blockId: publicId };
    }),
  };
}
