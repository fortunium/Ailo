import { randomUUID } from 'node:crypto';
import type { Question } from '../../shared/types';
import type { RunCallbacks } from './types';

export async function handleElicitation(request: { serverName: string; message: string; mode?: string; url?: string; requestedSchema?: any }, cb: RunCallbacks, signal?: AbortSignal): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: Record<string, string | number | boolean> }> {
  if (request.mode === 'url') {
    const url = new URL(request.url ?? '');
    if (!['https:', 'http:'].includes(url.protocol)) return { action: 'decline' };
    const decision = await cb.requestApproval({ title: `${request.serverName} asks to open a browser`, reason: request.message, detail: url.toString(), allowSession: false }, signal);
    if (decision !== 'approve') return { action: decision === 'cancelled' ? 'cancel' : 'decline' };
    cb.openUrl?.(url.toString()); return { action: 'accept' };
  }
  const schema = request.requestedSchema;
  const properties: [string, any][] = Object.entries(schema?.properties ?? {});
  if (schema?.type !== 'object' || properties.length > 20 || properties.some(([, s]) => !['string', 'number', 'integer', 'boolean'].includes(s?.type))) {
    cb.onItem({ kind: 'notice', id: randomUUID(), level: 'warning', text: `${request.serverName} requested an unsupported input form.`, at: new Date().toISOString() });
    return { action: 'decline' };
  }
  const questions: Question[] = properties.map(([name, field]) => ({ id: name, header: request.serverName,
    question: `${request.message}\n${field.title ?? name}${field.description ? ` — ${field.description}` : ''}`,
    options: [...(field.enum ?? (field.type === 'boolean' ? ['true', 'false'] : [])).map((value: unknown) => ({ label: String(value) })), ...(!schema.required?.includes(name) ? [{ label: 'Skip' }] : [])] }));
  const answers = questions.length ? await cb.requestAnswers(questions, signal) : {};
  if (!answers) return { action: 'cancel' };
  const content: Record<string, string | number | boolean> = {};
  for (const [name, field] of properties) {
    const answer = answers[name];
    if ((!answer || answer === 'Skip') && !schema.required?.includes(name)) continue;
    const value = field.type === 'boolean' ? answer === 'true' : field.type === 'number' || field.type === 'integer' ? Number(answer) : answer;
    if (value === undefined || (typeof value === 'number' && (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value)))) || (field.type === 'boolean' && !['true', 'false'].includes(answer)) || (field.enum && !field.enum.includes(value))) return { action: 'decline' };
    content[name] = value;
  }
  return { action: 'accept', content };
}
