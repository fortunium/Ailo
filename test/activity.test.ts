import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { claudeTaskActivity } from '../src/main/providers/claude-activity';
import { Activity } from '../src/renderer/src/components/Activity';

it('shows concurrent active actions and waiting for permission, and disappears when idle', () => {
  const items = [claudeTaskActivity({ type: 'system', subtype: 'task_started', task_id: 'fixture', description: 'Inspect files' })!];
  const props = { items, startedAt: new Date().toISOString() };
  expect(renderToStaticMarkup(createElement(Activity, { ...props, status: 'running' }))).toContain('Inspect files');
  expect(renderToStaticMarkup(createElement(Activity, { ...props, status: 'awaiting_input' }))).toContain('Waiting for your response');
  expect(renderToStaticMarkup(createElement(Activity, { ...props, status: 'idle' }))).toBe('');
  expect(claudeTaskActivity({ type: 'system', subtype: 'task_progress', task_id: 'fixture', summary: 'Reading configuration', last_tool_name: 'Read' })).toMatchObject({ id: 'task:fixture', status: 'running', output: 'Reading configuration\nCurrent tool: Read' });
  expect(claudeTaskActivity({ type: 'system', subtype: 'task_notification', task_id: 'fixture', status: 'completed' })).toMatchObject({ id: 'task:fixture', status: 'done' });
});
