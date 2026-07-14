import { IncomingMessage, ServerResponse } from 'http';
import { HttpError } from '../http/errors';
import { R, ResourceAction, Room } from '../types';
import { getRoom } from '../ws/room-manager';
import { parseApplyRequest, parseReadRequest } from './request-parser';
import { applyPatchToActiveRoom, readActiveRoom } from './service';
import { encodeNoteSnapshotXml } from './xml-codec';
import {
  getPublicBlockId,
  publicizeApplyResponseBlockIds,
  rememberBlockIdMapping,
  resolveApplyRequestBlockIds,
  resolveReadRequestBlockIds,
} from './block-id-mapping';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const READ_XML_PATH = '/internal/ai-note/readXml';
const APPLY_PATH = '/internal/ai-note/apply';

interface AiNoteRequestContext {
  resourceId: string;
  userId: string;
}

function sendJson<T>(res: ServerResponse, status: number, body: R<T>): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendXml(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体不是有效 JSON');
  }
}

function requireActiveRoom(resourceId: string): Room {
  const room = getRoom(resourceId);
  if (!room || room.connections.size === 0) {
    throw new HttpError(409, 'NOTE_ROOM_NOT_ACTIVE');
  }
  return room;
}

function readPublicActiveRoom(
  room: Room,
  request: ReturnType<typeof parseReadRequest>,
) {
  const wholeDocument = readActiveRoom(room, { includeAiContent: request.includeAiContent });
  const mapping = rememberBlockIdMapping(room.yDoc, wholeDocument);
  const resolvedRequest = resolveReadRequestBlockIds(room.yDoc, request);
  const document = resolvedRequest.scope && resolvedRequest.scope.kind !== 'whole_note'
    ? readActiveRoom(room, resolvedRequest)
    : wholeDocument;
  return { document, mapping };
}

async function handleReadXml(
  req: IncomingMessage,
  res: ServerResponse,
  context: AiNoteRequestContext,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED');
  }
  const rawBody = req.method === 'POST' ? await readJsonBody(req) : undefined;
  const request = parseReadRequest(rawBody);
  const room = requireActiveRoom(context.resourceId);
  const { document, mapping } = readPublicActiveRoom(room, request);
  sendXml(res, encodeNoteSnapshotXml(document, (id) => getPublicBlockId(mapping, id)));
}

async function handleApply(
  req: IncomingMessage,
  res: ServerResponse,
  context: AiNoteRequestContext,
): Promise<void> {
  if (req.method !== 'POST') {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED');
  }
  const parsedRequest = parseApplyRequest(await readJsonBody(req));
  const room = requireActiveRoom(context.resourceId);
  rememberBlockIdMapping(room.yDoc, readActiveRoom(room, { includeAiContent: false }));
  const resolvedRequest = resolveApplyRequestBlockIds(room.yDoc, parsedRequest);
  const response = applyPatchToActiveRoom(room, resolvedRequest, context.userId);
  const data = publicizeApplyResponseBlockIds(
    response,
    rememberBlockIdMapping(
      room.yDoc,
      readActiveRoom(room, { includeAiContent: false }),
    ),
  );
  sendJson(res, 200, {
    code: 200,
    msg: 'success',
    data,
  });
}

export async function handleAiNoteRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: AiNoteRequestContext,
): Promise<void> {
  if (url.pathname === READ_XML_PATH) {
    await handleReadXml(req, res, context);
  } else {
    await handleApply(req, res, context);
  }
}

export function getAiNoteRequiredAction(pathname: string): ResourceAction | undefined {
  if (pathname === READ_XML_PATH) return 'VIEW';
  if (pathname === APPLY_PATH) return 'EDIT';
  return undefined;
}
