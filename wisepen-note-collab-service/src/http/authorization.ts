import { IncomingMessage } from 'http';
import { checkPermission } from '../clients/note-service-client';
import { config } from '../config';
import { ResourceAction } from '../types';
import { HttpError } from './errors';

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const normalized = header?.trim();
  return normalized || undefined;
}

function parseGroupRoles(value: string | undefined): Record<string, number> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    const entries = Object.entries(parsed);
    if (entries.some(([, role]) => !Number.isInteger(role))) throw new Error();
    return Object.fromEntries(entries) as Record<string, number>;
  } catch {
    throw new HttpError(400, 'INVALID_GROUP_ROLE_MAP', 'X-Group-Role-Map 格式无效');
  }
}

export function requireInternalSource(req: IncomingMessage): void {
  const source = firstHeader(req.headers['x-from-source']);
  if (source !== config.security.fromSourceSecret) {
    throw new HttpError(404, 'NOT_FOUND');
  }
}

export interface AuthorizedResourceRequest {
  resourceId: string;
  userId: string;
}

export async function authorizeResourceRequest(
  req: IncomingMessage,
  url: URL,
  requiredAction: ResourceAction,
): Promise<AuthorizedResourceRequest> {
  requireInternalSource(req);
  const resourceId = url.searchParams.get('resourceId')?.trim();
  if (!resourceId) throw new HttpError(400, 'RESOURCE_ID_MISSING', '缺少 resourceId');
  const userId = firstHeader(req.headers['x-user-id']);
  if (!userId) throw new HttpError(400, 'USER_ID_MISSING', '缺少 X-User-Id');

  const groupRoles = parseGroupRoles(firstHeader(req.headers['x-group-role-map']));
  const permission = await checkPermission(resourceId, userId, groupRoles);
  if (
    permission.resourceAccessRole === 'NONE' ||
    !permission.allowedActions?.includes(requiredAction)
  ) {
    throw new HttpError(403, 'PERMISSION_DENIED');
  }
  return { resourceId, userId };
}
