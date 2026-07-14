import { IncomingMessage, ServerResponse } from 'http';
import { getAiNoteRequiredAction, handleAiNoteRequest } from '../ai-note/http-routes';
import { config } from '../config';
import {
  extractDeveloper,
  runWithDeveloperContext,
} from '../development-traffic/request-context';
import { openApiDocument } from '../openapi/document';
import {
  authorizeResourceRequest,
  requireInternalSource,
} from './authorization';
import { HttpError, toHttpError } from './errors';

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ code: status, msg: message, data: null }));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: config.serviceName }));
    return;
  }
  if (url.pathname === '/openapi.json') {
    if (req.method !== 'GET') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED');
    }
    requireInternalSource(req);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(openApiDocument));
    return;
  }
  const requiredAction = getAiNoteRequiredAction(url.pathname);
  if (requiredAction) {
    const authorization = await authorizeResourceRequest(req, url, requiredAction);
    await handleAiNoteRequest(req, res, url, authorization);
    return;
  }
  throw new HttpError(404, 'NOT_FOUND');
}

function handleError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) return;
  const httpError = toHttpError(error);
  if (httpError) {
    sendError(res, httpError.status, httpError.message);
    return;
  }
  console.error('[HTTP] Request failed', error);
  sendError(res, 500, 'INTERNAL_SERVER_ERROR');
}

export function createHttpHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    runWithDeveloperContext(extractDeveloper(req.headers), () => {
      handleRequest(req, res).catch((error) => handleError(res, error));
    });
  };
}
