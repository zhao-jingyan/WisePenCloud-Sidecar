import {
  EasyPatchOperation,
  JsonScalar,
  NoteApplyRequest,
  NoteReadRequest,
  NoteReadScope,
} from './types';
import { isValidEasyContentShape } from './easy-codec';
import { isRecord } from './value-utils';

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidRequestError(`${field} 必须是非空字符串`);
  }
  return value;
}

function parseAttributes(value: unknown, field: string): Record<string, JsonScalar> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new InvalidRequestError(`${field} 必须是对象`);
  const result: Record<string, JsonScalar> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item !== 'string' &&
      typeof item !== 'number' &&
      typeof item !== 'boolean'
    ) {
      throw new InvalidRequestError(`${field}.${key} 必须是字符串、数字或布尔值`);
    }
    result[key] = item;
  }
  return result;
}

function parseOperation(value: unknown, index: number): EasyPatchOperation {
  const field = `operations[${index}]`;
  if (!isRecord(value)) throw new InvalidRequestError(`${field} 必须是对象`);
  const opId = requireNonEmptyString(value.opId, `${field}.opId`);
  const kind = requireNonEmptyString(value.kind, `${field}.kind`);

  if (kind === 'deleteBlock') {
    return {
      opId,
      kind,
      blockId: requireNonEmptyString(value.blockId, `${field}.blockId`),
    };
  }
  if (kind === 'replaceContent') {
    if (!isValidEasyContentShape(value.content)) {
      throw new InvalidRequestError(`${field}.content 格式无效`);
    }
    return {
      opId,
      kind,
      blockId: requireNonEmptyString(value.blockId, `${field}.blockId`),
      content: value.content,
    };
  }
  if (kind === 'insertBlock') {
    if (value.position !== 'before' && value.position !== 'after') {
      throw new InvalidRequestError(`${field}.position 必须是 before 或 after`);
    }
    if (!isRecord(value.block)) {
      throw new InvalidRequestError(`${field}.block 必须是对象`);
    }
    if (!isValidEasyContentShape(value.block.content)) {
      throw new InvalidRequestError(`${field}.block.content 格式无效`);
    }
    return {
      opId,
      kind,
      anchorBlockId: requireNonEmptyString(value.anchorBlockId, `${field}.anchorBlockId`),
      position: value.position,
      block: {
        type: requireNonEmptyString(value.block.type, `${field}.block.type`),
        attrs: parseAttributes(value.block.attrs, `${field}.block.attrs`),
        content: value.block.content,
      },
    };
  }
  throw new InvalidRequestError(`${field}.kind 不受支持`);
}

export function parseApplyRequest(value: unknown): NoteApplyRequest {
  if (!isRecord(value)) throw new InvalidRequestError('请求体必须是对象');
  const patchId = requireNonEmptyString(value.patchId, 'patchId');
  const version = requireNonEmptyString(value.version, 'version');
  if (!version.startsWith('yjs-v1:')) {
    throw new InvalidRequestError('version 格式无效');
  }
  if (!Array.isArray(value.operations)) {
    throw new InvalidRequestError('operations 必须是数组');
  }
  if (value.operations.length === 0 || value.operations.length > 200) {
    throw new InvalidRequestError('operations 数量必须在 1 到 200 之间');
  }
  const operations = value.operations.map(parseOperation);
  const opIds = new Set(operations.map((operation) => operation.opId));
  if (opIds.size !== operations.length) {
    throw new InvalidRequestError('同一 patch 内 opId 不能重复');
  }
  return { patchId, version, operations };
}

function parseReadScope(value: unknown): NoteReadScope {
  if (value === undefined) return { kind: 'whole_note' };
  if (!isRecord(value)) throw new InvalidRequestError('scope 必须是对象');
  if (value.kind === 'whole_note') return { kind: 'whole_note' };
  if (value.kind === 'subtree') {
    return { kind: 'subtree', blockId: requireNonEmptyString(value.blockId, 'scope.blockId') };
  }
  if (value.kind === 'blocks') {
    if (!Array.isArray(value.blockIds) || value.blockIds.length === 0) {
      throw new InvalidRequestError('scope.blockIds 必须是非空数组');
    }
    return {
      kind: 'blocks',
      blockIds: value.blockIds.map((blockId, index) =>
        requireNonEmptyString(blockId, `scope.blockIds[${index}]`),
      ),
    };
  }
  if (value.kind === 'block_range') {
    return {
      kind: 'block_range',
      startBlockId: requireNonEmptyString(value.startBlockId, 'scope.startBlockId'),
      endBlockId: requireNonEmptyString(value.endBlockId, 'scope.endBlockId'),
    };
  }
  throw new InvalidRequestError('scope.kind 不受支持');
}

export function parseReadRequest(value: unknown): NoteReadRequest {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new InvalidRequestError('请求体必须是对象');
  if (value.includeAiContent !== undefined && typeof value.includeAiContent !== 'boolean') {
    throw new InvalidRequestError('includeAiContent 必须是布尔值');
  }
  const version = value.version === undefined
    ? undefined
    : requireNonEmptyString(value.version, 'version');
  if (version !== undefined && !version.startsWith('yjs-v1:')) {
    throw new InvalidRequestError('version 格式无效');
  }
  return {
    scope: parseReadScope(value.scope),
    includeAiContent: value.includeAiContent as boolean | undefined,
    version,
  };
}
