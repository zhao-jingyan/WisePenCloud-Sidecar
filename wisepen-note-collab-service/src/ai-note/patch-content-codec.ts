import {
  JsonScalar,
  NativeContent,
  NativeInline,
  NativeTableContent,
  NativeTextInline,
  PatchContent,
  PatchMark,
} from './types';
import { asFiniteNumber, isRecord } from './value-utils';

const INLINE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'quote',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'codeBlock',
  'highlightBlock',
  'mermaid',
]);
const EDITABLE_BLOCK_TYPES = new Set(
  [...INLINE_BLOCK_TYPES].filter((type) => type !== 'mermaid').concat('table'),
);
const PLAIN_TEXT_BLOCK_TYPES = new Set(['codeBlock', 'mermaid']);
const HIGHLIGHT_COLORS = new Set([
  'default', 'gray', 'brown', 'red', 'orange', 'yellow',
  'green', 'blue', 'purple', 'pink',
]);
const MARKS: PatchMark[] = ['bold', 'italic', 'underline', 'strike', 'code'];
const MARK_SET = new Set<string>(MARKS);

export function isEditableBlockType(type: string): boolean {
  return EDITABLE_BLOCK_TYPES.has(type);
}

function validateMarks(value: unknown): PatchMark[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((mark) => typeof mark !== 'string' || !MARK_SET.has(mark))) {
    return null;
  }
  return [...new Set(value)] as PatchMark[];
}

function patchInlineToNative(value: unknown): NativeInline | null {
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
    const native = patchInlineToNative(item);
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
    if (!Array.isArray(row) || row.length === 0) return null;
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

export function decodePatchContent(type: string, value: PatchContent): NativeContent | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (INLINE_BLOCK_TYPES.has(type)) {
    if (value.kind !== 'inline') return null;
    const items = decodeInlineItems(value.items);
    if (!PLAIN_TEXT_BLOCK_TYPES.has(type) || items === null) return items;
    if (items.some((item) => item.type !== 'text' || Object.keys(item.styles).length > 0)) {
      return null;
    }
    return items;
  }
  if (type === 'table') return value.kind === 'table' ? decodeTableContent(value) : null;
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
  if (type === 'highlightBlock') {
    allowed.add('icon');
    allowed.add('highlightBackgroundColor');
    allowed.add('highlightBorderColor');
    allowed.add('highlightTextColor');
  }
  if (INLINE_BLOCK_TYPES.has(type) && type !== 'highlightBlock') {
    allowed.add('backgroundColor');
    allowed.add('textColor');
    if (type !== 'quote') allowed.add('textAlignment');
  }
  if (type === 'highlightBlock') allowed.add('textAlignment');
  if (type === 'table') allowed.add('textColor');
  if (Object.keys(attributes).some((key) => !allowed.has(key))) return null;
  if (attributes.level !== undefined &&
      (!Number.isInteger(attributes.level) || Number(attributes.level) < 1 || Number(attributes.level) > 6)) {
    return null;
  }
  if (attributes.isToggleable !== undefined && typeof attributes.isToggleable !== 'boolean') return null;
  if (attributes.checked !== undefined && typeof attributes.checked !== 'boolean') return null;
  if (attributes.start !== undefined &&
      (!Number.isInteger(attributes.start) || Number(attributes.start) < 1)) return null;
  if (attributes.language !== undefined && typeof attributes.language !== 'string') return null;
  if (attributes.icon !== undefined && typeof attributes.icon !== 'string') return null;
  for (const key of ['highlightBackgroundColor', 'highlightTextColor'] as const) {
    if (attributes[key] !== undefined && !HIGHLIGHT_COLORS.has(String(attributes[key]))) return null;
  }
  if (attributes.highlightBorderColor !== undefined &&
      attributes.highlightBorderColor !== 'auto' &&
      !HIGHLIGHT_COLORS.has(String(attributes.highlightBorderColor))) return null;
  for (const key of ['highlightBackgroundColor', 'highlightBorderColor', 'highlightTextColor'] as const) {
    if (attributes[key] !== undefined && typeof attributes[key] !== 'string') return null;
  }
  for (const key of ['backgroundColor', 'textColor'] as const) {
    if (attributes[key] !== undefined && typeof attributes[key] !== 'string') return null;
  }
  if (attributes.textAlignment !== undefined &&
      !['left', 'center', 'right', 'justify'].includes(String(attributes.textAlignment))) return null;
  if (type === 'highlightBlock' && attributes.textAlignment !== undefined &&
      !['left', 'center', 'right'].includes(String(attributes.textAlignment))) return null;
  return attributes;
}

export function isValidPatchContentShape(value: unknown): value is PatchContent {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'inline') return decodeInlineItems(value.items) !== null;
  return value.kind === 'table' && decodeTableContent(value) !== null;
}
