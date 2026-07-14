import {
  EasyBlock,
  EasyContent,
  EasyInline,
  EasyMark,
  EasyNoteDocument,
  JsonScalar,
  NativeBlock,
  NativeContent,
  NativeInline,
  NativeTableContent,
  NativeTextInline,
  NoteReadScope,
} from './types';
import { asFiniteNumber, asString, isRecord } from './value-utils';

const INLINE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'quote',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'codeBlock',
]);
const ATOMIC_BLOCK_TYPES = new Set(['audio', 'divider', 'file', 'image', 'video']);
const EDITABLE_BLOCK_TYPES = new Set([...INLINE_BLOCK_TYPES, 'table']);
const MARKS: EasyMark[] = ['bold', 'italic', 'underline', 'strike', 'code'];
const MARK_SET = new Set<string>(MARKS);

function readMarks(styles: Record<string, boolean | string>): EasyMark[] | undefined {
  const marks = MARKS.filter((mark) => styles[mark] === true);
  return marks.length > 0 ? marks : undefined;
}

function nativeInlineToEasy(item: NativeInline): EasyInline[] {
  if (item.type === 'inlineMath') {
    return [{ type: 'inlineMath', expression: item.props.expression }];
  }
  if (item.type === 'link') {
    return item.content.map((part) => {
      const marks = readMarks(part.styles);
      return {
        type: 'link',
        text: part.text,
        href: item.href,
        ...(marks ? { marks } : {}),
      };
    });
  }
  const marks = readMarks(item.styles);
  const textColor = typeof item.styles.textColor === 'string' ? item.styles.textColor : undefined;
  const backgroundColor =
    typeof item.styles.backgroundColor === 'string' ? item.styles.backgroundColor : undefined;
  return [{
    type: 'text',
    text: item.text,
    ...(marks ? { marks } : {}),
    ...(textColor ? { textColor } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
  }];
}

function nativeTableToEasy(content: NativeTableContent): EasyContent {
  return {
    kind: 'table',
    headerRows: asFiniteNumber(content.headerRows, 0),
    headerCols: asFiniteNumber(content.headerCols, 0),
    rows: content.rows.map((row) =>
      row.cells.map((cell) => cell.content.flatMap(nativeInlineToEasy)),
    ),
  };
}

export function isEditableBlockType(type: string): boolean {
  return EDITABLE_BLOCK_TYPES.has(type);
}

function encodeEasyContentUnsafe(type: string, content: unknown): EasyContent {
  if (INLINE_BLOCK_TYPES.has(type)) {
    if (!Array.isArray(content)) return { kind: 'unsupported' };
    return { kind: 'inline', items: (content as NativeInline[]).flatMap(nativeInlineToEasy) };
  }
  if (type === 'table') {
    if (!isRecord(content) || content.type !== 'tableContent' || !Array.isArray(content.rows)) {
      return { kind: 'unsupported' };
    }
    return nativeTableToEasy(content as unknown as NativeTableContent);
  }
  if (type === 'math') {
    return typeof content === 'string'
      ? { kind: 'expression', expression: content }
      : { kind: 'unsupported' };
  }
  if (ATOMIC_BLOCK_TYPES.has(type)) return { kind: 'none' };
  return { kind: 'unsupported' };
}

export function encodeEasyContent(type: string, content: unknown): EasyContent {
  try {
    return encodeEasyContentUnsafe(type, content);
  } catch {
    return { kind: 'unsupported' };
  }
}

function simplifyAttributes(props: Record<string, unknown>): Record<string, JsonScalar> | undefined {
  const entries = Object.entries(props).filter(
    (entry): entry is [string, JsonScalar] =>
      typeof entry[1] === 'string' ||
      typeof entry[1] === 'number' ||
      typeof entry[1] === 'boolean',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function encodeBlocks(blocks: NativeBlock[], nextLine: { value: number }): EasyBlock[] {
  return blocks.map((block) => {
    const line = nextLine.value;
    nextLine.value += 1;
    const attrs = simplifyAttributes(block.props);
    const result: EasyBlock = {
      line,
      id: block.id,
      type: block.type,
      editable: isEditableBlockType(block.type),
      ...(attrs ? { attrs } : {}),
      content: encodeEasyContent(block.type, block.content),
      children: encodeBlocks(block.children, nextLine),
    };
    if (block.aiContent !== undefined) {
      result.aiContent = encodeEasyContent(block.type, block.aiContent);
    }
    return result;
  });
}

function findEasyBlock(blocks: EasyBlock[], blockId: string): EasyBlock | undefined {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const nested = findEasyBlock(block.children, blockId);
    if (nested) return nested;
  }
  return undefined;
}

function flattenBlocks(blocks: EasyBlock[]): EasyBlock[] {
  const result: EasyBlock[] = [];
  for (const block of blocks) {
    result.push({ ...block, children: [] });
    result.push(...flattenBlocks(block.children));
  }
  return result;
}

function applyScope(blocks: EasyBlock[], scope: NoteReadScope): EasyBlock[] {
  if (scope.kind === 'whole_note') return blocks;
  if (scope.kind === 'subtree') {
    const block = findEasyBlock(blocks, scope.blockId);
    return block ? [block] : [];
  }
  if (scope.kind === 'blocks') {
    return scope.blockIds
      .map((blockId) => findEasyBlock(blocks, blockId))
      .filter((block): block is EasyBlock => block !== undefined);
  }
  const flattened = flattenBlocks(blocks);
  const start = flattened.findIndex((block) => block.id === scope.startBlockId);
  const end = flattened.findIndex((block) => block.id === scope.endBlockId);
  if (start < 0 || end < 0 || start > end) return [];
  return flattened.slice(start, end + 1);
}

export function encodeEasyDocument(
  resourceId: string,
  version: string,
  nativeBlocks: NativeBlock[],
  scope: NoteReadScope = { kind: 'whole_note' },
): EasyNoteDocument {
  const blocks = encodeBlocks(nativeBlocks, { value: 1 });
  return {
    format: 'wisepen-note-easy-json',
    formatVersion: 1,
    resourceId,
    version,
    blocks: applyScope(blocks, scope),
  };
}

function validateMarks(value: unknown): EasyMark[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((mark) => typeof mark !== 'string' || !MARK_SET.has(mark))) {
    return null;
  }
  return [...new Set(value)] as EasyMark[];
}

function easyInlineToNative(value: unknown): NativeInline | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'inlineMath') {
    return typeof value.expression === 'string'
      ? { type: 'inlineMath', props: { expression: value.expression } }
      : null;
  }
  if (value.type !== 'text' && value.type !== 'link') return null;
  if (typeof value.text !== 'string') return null;
  const marks = validateMarks(value.marks);
  if (marks === null) return null;
  const styles: Record<string, boolean | string> = {};
  marks?.forEach((mark) => {
    styles[mark] = true;
  });
  if (value.type === 'text') {
    if (value.textColor !== undefined && typeof value.textColor !== 'string') return null;
    if (value.backgroundColor !== undefined && typeof value.backgroundColor !== 'string') return null;
    if (typeof value.textColor === 'string') styles.textColor = value.textColor;
    if (typeof value.backgroundColor === 'string') styles.backgroundColor = value.backgroundColor;
    return { type: 'text', text: value.text, styles };
  }
  if (typeof value.href !== 'string' || value.href.length === 0) return null;
  const text: NativeTextInline = { type: 'text', text: value.text, styles };
  return { type: 'link', href: value.href, content: [text] };
}

function decodeInlineItems(items: unknown): NativeInline[] | null {
  if (!Array.isArray(items)) return null;
  const result: NativeInline[] = [];
  for (const item of items) {
    const native = easyInlineToNative(item);
    if (!native) return null;
    result.push(native);
  }
  return result;
}

function decodeTableContent(value: Record<string, unknown>): NativeTableContent | null {
  if (!Array.isArray(value.rows)) return null;
  const headerRows = asFiniteNumber(value.headerRows, -1);
  const headerCols = asFiniteNumber(value.headerCols, -1);
  if (!Number.isInteger(headerRows) || !Number.isInteger(headerCols) || headerRows < 0 || headerCols < 0) {
    return null;
  }
  const rows: NativeTableContent['rows'] = [];
  let expectedColumnCount: number | undefined;
  for (const row of value.rows) {
    if (!Array.isArray(row)) return null;
    if (row.length === 0) return null;
    if (expectedColumnCount === undefined) expectedColumnCount = row.length;
    if (row.length !== expectedColumnCount) return null;
    const cells: NativeTableContent['rows'][number]['cells'] = [];
    for (const cell of row) {
      const content = decodeInlineItems(cell);
      if (!content) return null;
      cells.push({
        type: 'tableCell',
        content,
        props: {
          colspan: 1,
          rowspan: 1,
          backgroundColor: 'default',
          textColor: 'default',
          textAlignment: 'left',
        },
      });
    }
    rows.push({ cells });
  }
  const columnCount = Math.max(0, ...rows.map((row) => row.cells.length));
  if (headerRows > rows.length || headerCols > columnCount) return null;
  return {
    type: 'tableContent',
    columnWidths: Array.from({ length: columnCount }, () => 100),
    headerRows,
    headerCols,
    rows,
  };
}

export function decodeEasyContent(type: string, value: EasyContent): NativeContent | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (INLINE_BLOCK_TYPES.has(type)) {
    if (value.kind !== 'inline') return null;
    const items = decodeInlineItems(value.items);
    if (type !== 'codeBlock' || items === null) return items;
    if (
      items.some(
        (item) => item.type !== 'text' || Object.keys(item.styles).length > 0,
      )
    ) {
      return null;
    }
    return items;
  }
  if (type === 'table') {
    return value.kind === 'table' ? decodeTableContent(value) : null;
  }
  return null;
}

export function emptyNativeContent(type: string): NativeContent | null {
  if (INLINE_BLOCK_TYPES.has(type)) return [];
  if (type === 'table') {
    return {
      type: 'tableContent',
      columnWidths: [],
      headerRows: 0,
      headerCols: 0,
      rows: [],
    };
  }
  return null;
}

export function sanitizeBlockAttributes(
  type: string,
  attributes: Record<string, JsonScalar> | undefined,
): Record<string, JsonScalar> | null {
  if (!attributes) return {};
  const allowed = new Set<string>();
  if (type === 'heading') {
    allowed.add('level');
    allowed.add('isToggleable');
  }
  if (type === 'checkListItem') allowed.add('checked');
  if (type === 'numberedListItem') allowed.add('start');
  if (type === 'codeBlock') allowed.add('language');
  if (INLINE_BLOCK_TYPES.has(type)) {
    allowed.add('backgroundColor');
    allowed.add('textColor');
    if (type !== 'quote') allowed.add('textAlignment');
  }
  if (type === 'table') allowed.add('textColor');
  if (Object.keys(attributes).some((key) => !allowed.has(key))) return null;
  if (
    attributes.level !== undefined &&
    (!Number.isInteger(attributes.level) || Number(attributes.level) < 1 || Number(attributes.level) > 6)
  ) {
    return null;
  }
  if (attributes.isToggleable !== undefined && typeof attributes.isToggleable !== 'boolean') {
    return null;
  }
  if (attributes.checked !== undefined && typeof attributes.checked !== 'boolean') return null;
  if (
    attributes.start !== undefined &&
    (!Number.isInteger(attributes.start) || Number(attributes.start) < 1)
  ) {
    return null;
  }
  if (attributes.language !== undefined && typeof attributes.language !== 'string') return null;
  for (const key of ['backgroundColor', 'textColor'] as const) {
    if (attributes[key] !== undefined && typeof attributes[key] !== 'string') return null;
  }
  if (
    attributes.textAlignment !== undefined &&
    !['left', 'center', 'right', 'justify'].includes(String(attributes.textAlignment))
  ) {
    return null;
  }
  return attributes;
}

export function isValidEasyContentShape(value: unknown): value is EasyContent {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'inline') return decodeInlineItems(value.items) !== null;
  if (value.kind === 'table') {
    return decodeTableContent(value) !== null;
  }
  if (value.kind === 'expression') return typeof value.expression === 'string';
  return value.kind === 'none' || value.kind === 'unsupported';
}
