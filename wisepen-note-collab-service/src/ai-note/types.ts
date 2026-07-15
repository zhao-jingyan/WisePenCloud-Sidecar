export type JsonScalar = string | number | boolean;

export type EasyMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

export type EasyInline =
  | {
      type: 'text';
      text: string;
      marks?: EasyMark[];
      textColor?: string;
      backgroundColor?: string;
    }
  | {
      type: 'link';
      text: string;
      href: string;
      marks?: EasyMark[];
    }
  | {
      type: 'inlineMath';
      expression: string;
    };

export type EasyContent =
  | { kind: 'inline'; items: EasyInline[] }
  | { kind: 'table'; headerRows: number; headerCols: number; rows: EasyInline[][][] }
  | { kind: 'expression'; expression: string }
  | { kind: 'none' }
  | { kind: 'unsupported' };

export interface EasyBlock {
  line: number;
  id: string;
  type: string;
  editable: boolean;
  attrs?: Record<string, JsonScalar>;
  content: EasyContent;
  aiContent?: EasyContent;
  children: EasyBlock[];
}

export interface EasyNoteDocument {
  format: 'wisepen-note-easy-json';
  formatVersion: 1;
  resourceId: string;
  version: string;
  blocks: EasyBlock[];
}

export type NoteReadScope =
  | { kind: 'whole_note' }
  | { kind: 'blocks'; blockIds: string[] }
  | { kind: 'subtree'; blockId: string }
  | { kind: 'block_range'; startBlockId: string; endBlockId: string };

export interface NoteReadRequest {
  scope?: NoteReadScope;
  includeAiContent?: boolean;
  version?: string;
}

export interface NativeTextInline {
  type: 'text';
  text: string;
  styles: Record<string, boolean | string>;
}

export interface NativeLinkInline {
  type: 'link';
  href: string;
  content: NativeTextInline[];
}

export interface NativeMathInline {
  type: 'inlineMath';
  props: { expression: string };
}

export type NativeInline = NativeTextInline | NativeLinkInline | NativeMathInline;

export interface NativeTableCell {
  type: 'tableCell';
  content: NativeInline[];
  props: {
    colspan: number;
    rowspan: number;
    backgroundColor: string;
    textColor: string;
    textAlignment: string;
  };
}

export interface NativeTableContent {
  type: 'tableContent';
  columnWidths: number[];
  headerRows: number;
  headerCols: number;
  rows: Array<{ cells: NativeTableCell[] }>;
}

export type NativeContent = NativeInline[] | NativeTableContent | string | undefined;

export interface NativeBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: NativeContent;
  aiContent?: unknown;
  children: NativeBlock[];
}

export type EasyPatchOperation =
  | { opId: string; kind: 'replaceContent'; blockId: string; content: EasyContent }
  | { opId: string; kind: 'deleteBlock'; blockId: string }
  | {
      opId: string;
      kind: 'insertBlock';
      anchorBlockId: string;
      position: 'before' | 'after';
      block: {
        type: string;
        attrs?: Record<string, JsonScalar>;
        content: EasyContent;
      };
    };

export interface NoteApplyRequest {
  patchId: string;
  version: string;
  operations: EasyPatchOperation[];
}

export type ApplyConflictReason =
  | 'block_missing'
  | 'anchor_missing'
  | 'unsupported_type'
  | 'invalid_content';

export interface ApplyOperationResult {
  opId: string;
  status: 'applied' | 'unchanged' | 'conflict';
  reason?: ApplyConflictReason;
  blockId?: string;
}

export interface NoteApplyResponse {
  resourceId: string;
  requestedVersion: string;
  currentVersion: string;
  resultVersion: string;
  modified: boolean;
  results: ApplyOperationResult[];
}
