import { IncomingMessage, ServerResponse } from 'http';
import { checkPermission } from '../clients/note-service-client';
import { config } from '../config';
import {
  extractDeveloper,
  runWithDeveloperContext,
} from '../development-traffic/request-context';
import { R, ResourceAction, Room } from '../types';
import { getRoom } from '../ws/room-manager';
import { parseApplyRequest, parseReadRequest, InvalidRequestError } from './request-parser';
import { applyPatchToActiveRoom, readActiveRoom } from './service';
import { isRecord } from './value-utils';
import { openApiDocument } from '../openapi/document';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const READ_PATHS = new Set(['/internal/ai-note/read', '/note-collab/internal/ai-note/read']);
const APPLY_PATHS = new Set(['/internal/ai-note/apply', '/note-collab/internal/ai-note/apply']);

class PayloadTooLargeError extends Error {}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const normalized = header?.trim();
  return normalized || undefined;
}

function sendJson<T>(res: ServerResponse, status: number, body: R<T>): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { code: status, msg: message, data: null });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InvalidRequestError('请求体不是有效 JSON');
  }
}

function parseGroupRoles(value: string | undefined): Record<string, number> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) throw new Error();
    const entries = Object.entries(parsed);
    if (entries.some(([, role]) => !Number.isInteger(role))) throw new Error();
    return Object.fromEntries(entries) as Record<string, number>;
  } catch {
    throw new InvalidRequestError('X-Group-Role-Map 格式无效');
  }
}

async function authorize(
  req: IncomingMessage,
  resourceId: string,
  requiredAction: ResourceAction,
): Promise<string> {
  assertInternalSource(req);
  const userId = firstHeader(req.headers['x-user-id']);
  if (!userId) throw new InvalidRequestError('缺少 X-User-Id');
  const groupRoles = parseGroupRoles(firstHeader(req.headers['x-group-role-map']));
  const permission = await checkPermission(resourceId, userId, groupRoles);
  if (
    permission.resourceAccessRole === 'NONE' ||
    !permission.allowedActions?.includes(requiredAction)
  ) {
    const error = new Error('PERMISSION_DENIED');
    error.name = 'PermissionDeniedError';
    throw error;
  }
  return userId;
}

function assertInternalSource(req: IncomingMessage): void {
  const source = firstHeader(req.headers['x-from-source']);
  if (source !== config.security.fromSourceSecret) {
    const error = new Error('NOT_FOUND');
    error.name = 'NotFoundError';
    throw error;
  }
}

function requireResourceId(url: URL): string {
  const resourceId = url.searchParams.get('resourceId')?.trim();
  if (!resourceId) throw new InvalidRequestError('缺少 resourceId');
  return resourceId;
}

function requireActiveRoom(resourceId: string): Room {
  const room = getRoom(resourceId);
  if (!room || room.connections.size === 0) {
    const error = new Error('NOTE_ROOM_NOT_ACTIVE');
    error.name = 'RoomNotActiveError';
    throw error;
  }
  return room;
}

async function handleRead(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }
  assertInternalSource(req);
  const resourceId = requireResourceId(url);
  await authorize(req, resourceId, 'VIEW');
  const rawBody = req.method === 'POST' ? await readJsonBody(req) : undefined;
  const request = parseReadRequest(rawBody);
  const room = requireActiveRoom(resourceId);
  sendJson(res, 200, { code: 200, msg: 'success', data: readActiveRoom(room, request) });
}

async function handleApply(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }
  assertInternalSource(req);
  const resourceId = requireResourceId(url);
  const userId = await authorize(req, resourceId, 'EDIT');
  const request = parseApplyRequest(await readJsonBody(req));
  const room = requireActiveRoom(resourceId);
  sendJson(res, 200, {
    code: 200,
    msg: 'success',
    data: applyPatchToActiveRoom(room, request, userId),
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: config.serviceName }));
    return;
  }
  if (url.pathname === '/openapi.json') {
    if (req.method !== 'GET') {
      sendError(res, 405, 'METHOD_NOT_ALLOWED');
      return;
    }
    assertInternalSource(req);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(openApiDocument));
    return;
  }
  if (READ_PATHS.has(url.pathname)) {
    await handleRead(req, res, url);
    return;
  }
  if (APPLY_PATHS.has(url.pathname)) {
    await handleApply(req, res, url);
    return;
  }
  sendError(res, 404, 'NOT_FOUND');
}

function handleError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) return;
  if (error instanceof PayloadTooLargeError) {
    sendError(res, 413, 'PAYLOAD_TOO_LARGE');
    return;
  }
  if (error instanceof InvalidRequestError) {
    sendError(res, 400, error.message);
    return;
  }
  if (error instanceof Error && error.name === 'NotFoundError') {
    sendError(res, 404, 'NOT_FOUND');
    return;
  }
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    sendError(res, 403, 'PERMISSION_DENIED');
    return;
  }
  if (error instanceof Error && error.name === 'RoomNotActiveError') {
    sendError(res, 409, 'NOTE_ROOM_NOT_ACTIVE');
    return;
  }
  console.error('[HTTP] Internal request failed', error);
  sendError(res, 500, 'INTERNAL_SERVER_ERROR');
}

export function createHttpHandler(
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    runWithDeveloperContext(extractDeveloper(req.headers), () => {
      handleRequest(req, res).catch((error) => handleError(res, error));
    });
  };
}
