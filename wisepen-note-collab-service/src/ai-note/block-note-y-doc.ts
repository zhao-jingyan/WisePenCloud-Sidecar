import * as Y from 'yjs';
import {
  NativeBlock,
  NativeInline,
  NativeLinkInline,
  NativeTableCell,
  NativeTableContent,
  NativeTextInline,
} from './types';
import { asFiniteNumber, asString, isRecord } from './value-utils';

const DOCUMENT_STORE = 'document-store';
const AI_CONTENT_STORE = 'ai-content-store';

type XmlParent = Y.XmlFragment | Y.XmlElement;

export interface BlockLocation {
  container: Y.XmlElement;
  block: Y.XmlElement;
  parentGroup: XmlParent;
  index: number;
}

function readAttributeValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ('stringValue' in value) return value.stringValue;
  return value;
}

function readAttributes(element: Y.XmlElement): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(element.getAttributes()).map(([key, value]) => [
      key,
      readAttributeValue(value),
    ]),
  );
}

function readTextStyles(attributes: Record<string, unknown>): Record<string, boolean | string> {
  const result: Record<string, boolean | string> = {};
  for (const [key, rawValue] of Object.entries(attributes)) {
    if (key === 'link') continue;
    const value = readAttributeValue(rawValue);
    if (value === false || value == null) continue;
    result[key] = typeof value === 'string' ? value : true;
  }
  return result;
}

function readLinkHref(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  return typeof value.href === 'string' ? value.href : undefined;
}

function readXmlText(text: Y.XmlText): NativeInline[] {
  const result: NativeInline[] = [];
  for (const part of text.toDelta()) {
    if (typeof part.insert !== 'string' || part.insert.length === 0) continue;
    const attributes = isRecord(part.attributes) ? part.attributes : {};
    const nativeText: NativeTextInline = {
      type: 'text',
      text: part.insert,
      styles: readTextStyles(attributes),
    };
    const href = readLinkHref(attributes.link);
    if (href) {
      const link: NativeLinkInline = { type: 'link', href, content: [nativeText] };
      result.push(link);
    } else {
      result.push(nativeText);
    }
  }
  return result;
}

function readInlineElement(element: Y.XmlElement): NativeInline[] {
  if (element.nodeName === 'inlineMath') {
    return [
      {
        type: 'inlineMath',
        props: { expression: asString(element.getAttribute('expression')) },
      },
    ];
  }

  const result: NativeInline[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) result.push(...readXmlText(child));
    if (child instanceof Y.XmlElement) result.push(...readInlineElement(child));
  }
  return result;
}

function readInlineContent(element: Y.XmlElement): NativeInline[] {
  const result: NativeInline[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) result.push(...readXmlText(child));
    if (child instanceof Y.XmlElement) result.push(...readInlineElement(child));
  }
  return result;
}

function directElements(element: Y.XmlElement, names: readonly string[]): Y.XmlElement[] {
  return element
    .toArray()
    .filter(
      (child): child is Y.XmlElement =>
        child instanceof Y.XmlElement && names.includes(child.nodeName),
    );
}

function readTableContent(element: Y.XmlElement): NativeTableContent {
  const rowElements = directElements(element, ['tableRow']);
  const firstRowCells = rowElements[0]
    ? directElements(rowElements[0], ['tableCell', 'tableHeader'])
    : [];

  const rows = rowElements.map((rowElement) => ({
    cells: directElements(rowElement, ['tableCell', 'tableHeader']).map((cellElement) => {
      const attributes = readAttributes(cellElement);
      const cell: NativeTableCell = {
        type: 'tableCell',
        content: readInlineContent(cellElement),
        props: {
          colspan: asFiniteNumber(attributes.colspan, 1),
          rowspan: asFiniteNumber(attributes.rowspan, 1),
          backgroundColor: asString(attributes.backgroundColor, 'default'),
          textColor: asString(attributes.textColor, 'default'),
          textAlignment: asString(attributes.textAlignment, 'left'),
        },
      };
      return cell;
    }),
  }));

  let headerRows = 0;
  for (const rowElement of rowElements) {
    const cells = directElements(rowElement, ['tableCell', 'tableHeader']);
    if (cells.length === 0 || cells.some((cell) => cell.nodeName !== 'tableHeader')) break;
    headerRows += 1;
  }

  let headerCols = 0;
  const columnCount = Math.max(0, ...rows.map((row) => row.cells.length));
  for (let column = 0; column < columnCount; column += 1) {
    const columnCells = rowElements.map((row) =>
      directElements(row, ['tableCell', 'tableHeader'])[column],
    );
    if (columnCells.some((cell) => !cell || cell.nodeName !== 'tableHeader')) break;
    headerCols += 1;
  }

  return {
    type: 'tableContent',
    columnWidths: firstRowCells.map((cell) =>
      asFiniteNumber(cell.getAttribute('colwidth'), 100),
    ),
    headerRows,
    headerCols,
    rows,
  };
}

function findChildGroup(container: Y.XmlElement): Y.XmlElement | undefined {
  return container
    .toArray()
    .find(
      (child): child is Y.XmlElement =>
        child instanceof Y.XmlElement && child.nodeName === 'blockGroup',
    );
}

function findBlockElement(container: Y.XmlElement): Y.XmlElement | undefined {
  return container
    .toArray()
    .find(
      (child): child is Y.XmlElement =>
        child instanceof Y.XmlElement && child.nodeName !== 'blockGroup',
    );
}

function readBlockContainer(
  container: Y.XmlElement,
  aiContentStore: Y.Map<unknown>,
  includeAiContent: boolean,
): NativeBlock | undefined {
  const blockElement = findBlockElement(container);
  const id = container.getAttribute('id');
  if (!blockElement || typeof id !== 'string' || id.length === 0) return undefined;

  const childGroup = findChildGroup(container);
  const block: NativeBlock = {
    id,
    type: blockElement.nodeName,
    props: readAttributes(blockElement),
    content:
      blockElement.nodeName === 'table'
        ? readTableContent(blockElement)
        : blockElement.nodeName === 'math'
          ? asString(blockElement.getAttribute('expression'))
          : readInlineContent(blockElement),
    children: childGroup
      ? readBlockGroup(childGroup, aiContentStore, includeAiContent)
      : [],
  };
  if (includeAiContent && aiContentStore.has(id)) {
    block.aiContent = aiContentStore.get(id);
  }
  return block;
}

function readBlockGroup(
  group: XmlParent,
  aiContentStore: Y.Map<unknown>,
  includeAiContent: boolean,
): NativeBlock[] {
  const result: NativeBlock[] = [];
  for (const child of group.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === 'blockContainer') {
      const block = readBlockContainer(child, aiContentStore, includeAiContent);
      if (block) result.push(block);
      continue;
    }
    if (child.nodeName === 'blockGroup') {
      result.push(...readBlockGroup(child, aiContentStore, includeAiContent));
    }
  }
  return result;
}

export function readNativeBlocks(doc: Y.Doc, includeAiContent = true): NativeBlock[] {
  const fragment = doc.getXmlFragment(DOCUMENT_STORE);
  const aiContentStore = doc.getMap<unknown>(AI_CONTENT_STORE);
  return readBlockGroup(fragment, aiContentStore, includeAiContent);
}

function findLocationInGroup(group: XmlParent, blockId: string): BlockLocation | undefined {
  const children = group.toArray();
  for (let index = 0; index < children.length; index += 1) {
    const container = children[index];
    if (!(container instanceof Y.XmlElement)) continue;
    if (container.nodeName !== 'blockContainer') {
      if (container.nodeName === 'blockGroup') {
        const nested = findLocationInGroup(container, blockId);
        if (nested) return nested;
      }
      continue;
    }
    const block = findBlockElement(container);
    if (container.getAttribute('id') === blockId && block) {
      return { container, block, parentGroup: group, index };
    }
    const childGroup = findChildGroup(container);
    if (childGroup) {
      const nested = findLocationInGroup(childGroup, blockId);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function findBlockLocation(doc: Y.Doc, blockId: string): BlockLocation | undefined {
  return findLocationInGroup(doc.getXmlFragment(DOCUMENT_STORE), blockId);
}

function setAttributes(element: Y.XmlElement, attributes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    element.setAttribute(key, value as string);
  }
}

function defaultBlockAttributes(type: string): Record<string, unknown> {
  if (type === 'table') return { textColor: 'default' };
  if (type === 'codeBlock') return { language: 'text' };
  if (type === 'quote') return { backgroundColor: 'default', textColor: 'default' };
  const common = {
    backgroundColor: 'default',
    textColor: 'default',
    textAlignment: 'left',
  };
  if (type === 'heading') return { ...common, level: 1, isToggleable: false };
  if (type === 'checkListItem') return { ...common, checked: false };
  return common;
}

function createEmptyTableElement(): Y.XmlElement {
  const table = new Y.XmlElement('table');
  setAttributes(table, defaultBlockAttributes('table'));
  const row = new Y.XmlElement('tableRow');
  const cell = new Y.XmlElement('tableCell');
  setAttributes(cell, {
    backgroundColor: 'default',
    colspan: 1,
    colwidth: [100],
    rowspan: 1,
    textAlignment: 'left',
    textColor: 'default',
  });
  const paragraph = new Y.XmlElement('tableParagraph');
  paragraph.insert(0, [new Y.XmlText()]);
  cell.insert(0, [paragraph]);
  row.insert(0, [cell]);
  table.insert(0, [row]);
  return table;
}

export function insertEmptyBlock(
  doc: Y.Doc,
  anchor: BlockLocation,
  position: 'before' | 'after',
  blockId: string,
  type: string,
  attributes: Record<string, unknown>,
): BlockLocation {
  const container = new Y.XmlElement('blockContainer');
  container.setAttribute('id', blockId);
  const block = type === 'table' ? createEmptyTableElement() : new Y.XmlElement(type);
  setAttributes(block, { ...defaultBlockAttributes(type), ...attributes });
  if (type !== 'table') block.insert(0, [new Y.XmlText()]);
  container.insert(0, [block]);
  const index = anchor.index + (position === 'after' ? 1 : 0);
  anchor.parentGroup.insert(index, [container]);
  return { container, block, parentGroup: anchor.parentGroup, index };
}

export function getAiContentStore(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(AI_CONTENT_STORE);
}
