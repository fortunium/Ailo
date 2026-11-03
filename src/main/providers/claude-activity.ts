import type { ChatItem } from '../../shared/types';

export function claudeTaskActivity(msg: any): ChatItem | undefined {
  if (msg.type !== 'system' || !['task_started', 'task_progress', 'task_notification'].includes(msg.subtype)) return;
  return {
    kind: 'tool', id: `task:${msg.task_id}`, title: 'Background task',
    subtitle: msg.description ?? msg.summary ?? msg.task_id,
    output: [msg.summary, msg.last_tool_name && `Current tool: ${msg.last_tool_name}`].filter(Boolean).join('\n') || undefined,
    status: msg.subtype !== 'task_notification' ? 'running' : msg.status === 'completed' ? 'done' : 'failed',
    at: new Date().toISOString()
  };
}
