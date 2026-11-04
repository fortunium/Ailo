import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CronExpressionParser } from 'cron-parser';
import type { Automation, AutomationInput, AutomationRun, AutomationSchedule, Conversation } from '../shared/types';
import type { AiloService } from './service';

const exec = promisify(execFile);
const active = new Set<AutomationRun['status']>(['queued', 'running', 'needs_attention']);

export function nextScheduledRun(schedule: AutomationSchedule, after: Date): string | undefined {
  if (!['manual', 'daily', 'weekdays', 'weekly'].includes(schedule.frequency)) throw new Error('Invalid schedule frequency.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) throw new Error('Enter a valid time (HH:mm).');
  new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone }).format(after);
  if (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6) throw new Error('Choose a valid weekday.');
  if (schedule.frequency === 'manual') return undefined;
  const [hour, minute] = schedule.time.split(':').map(Number);
  const day = schedule.frequency === 'weekdays' ? '1-5' : schedule.frequency === 'weekly' ? schedule.weekday : '*';
  return CronExpressionParser.parse(`${minute} ${hour} * * ${day}`, { tz: schedule.timeZone, currentDate: after }).next().toISOString()!;
}

export class AutomationManager {
  private interval?: ReturnType<typeof setInterval>;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private ticking = false;
  private stopping = false;
  private lastTick?: number;
  constructor(private service: AiloService, private publish: () => void) {}
  private get state() { return this.service.state; }

  save(input: AutomationInput, clock = new Date()): Automation {
    const previous = input.id ? this.state.automations.find((a) => a.id === input.id) : undefined;
    if (input.id && !previous) throw new Error('Automation not found.');
    if (!input.name?.trim() || !input.prompt?.trim()) throw new Error('Give the task a name and instructions.');
    this.service.account(input.accountId);
    if (!['report', 'workspace', 'worktree'].includes(input.mode)) throw new Error('Choose an execution mode.');
    if (!Number.isInteger(input.timeoutMinutes) || input.timeoutMinutes < 1 || input.timeoutMinutes > 180) throw new Error('Time limit must be between 1 and 180 minutes.');
    const folders = input.projectId ? this.service.project(input.projectId).folders : input.folders;
    if (!folders?.length) throw new Error('Choose a project or working folder.');
    this.service.validateFolders(folders);
    if (input.mode === 'worktree' && folders.length !== 1) throw new Error('Worktree tasks need one Git repository.');
    this.service.snapshotTools(input.tools, this.service.account(input.accountId).provider);
    if (input.mode === 'report' && (input.tools.connectionIds.length || input.tools.pluginIds.length || input.tools.accountMcpNames?.length)) throw new Error('Report mode uses built-in reading tools only. Choose another mode to use MCP connections or plugins.');
    const nextRunAt = nextScheduledRun(input.schedule, clock);
    const definition: Automation = {
      id: previous?.id ?? randomUUID(), name: input.name.trim(), prompt: input.prompt.trim(), accountId: input.accountId,
      projectId: input.projectId || undefined, folders: input.projectId ? undefined : [...folders],
      options: { ...input.options }, tools: structuredClone(input.tools), mode: input.mode, schedule: { ...input.schedule },
      enabled: !!input.enabled, timeoutMinutes: input.timeoutMinutes, nextRunAt: input.enabled ? nextRunAt : undefined,
      createdAt: previous?.createdAt ?? clock.toISOString(), updatedAt: clock.toISOString()
    };
    if (previous) this.state.automations[this.state.automations.indexOf(previous)] = definition;
    else this.state.automations.push(definition);
    this.publish(); return definition;
  }

  remove(id: string): void {
    if (this.state.automationRuns.some((r) => r.automationId === id && active.has(r.status))) throw new Error('Stop the active task before removing it.');
    this.state.automations = this.state.automations.filter((a) => a.id !== id);
    this.publish();
  }

  async run(id: string, trigger: AutomationRun['trigger'] = 'manual', scheduledAt?: string): Promise<AutomationRun> {
    const definition = this.state.automations.find((a) => a.id === id);
    if (!definition) throw new Error('Automation not found.');
    if (this.stopping) throw new Error('Ailo is shutting down.');
    if (this.state.automationRuns.some((r) => r.automationId === id && active.has(r.status))) throw new Error('This task already has an active run.');
    const run: AutomationRun = { id: randomUUID(), automationId: id, definition: structuredClone(definition), trigger, scheduledAt, status: 'queued', startedAt: new Date().toISOString() };
    run.definition.folders = [...(definition.projectId ? this.service.project(definition.projectId).folders : definition.folders!)];
    this.state.automationRuns.push(run); this.publish();
    try { run.tools = this.service.snapshotTools(run.definition.tools, this.service.account(run.definition.accountId).provider); }
    catch (e) { this.finish(run, 'blocked', (e as Error).message); return run; }
    void this.start(run).catch((e) => this.finish(run, 'failed', (e as Error).message));
    return run;
  }

  private async start(run: AutomationRun): Promise<void> {
    const def = run.definition;
    const connection = await this.service.checkAccount(def.accountId);
    if (run.status !== 'queued' || this.stopping) return;
    if (connection.state !== 'connected') return this.finish(run, 'blocked', 'The selected AI account needs attention. Sign in and run this task again.');
    const usage = await this.service.refreshUsage(def.accountId).catch(() => undefined);
    if (run.status !== 'queued' || this.stopping) return;
    if (usage?.windows.some((w) => w.usedPercent >= 100 && (!w.resetsAt || Date.parse(w.resetsAt) > Date.now()))) return this.finish(run, 'blocked', 'The selected account has reached a usage limit. Run again after the limit resets.');
    let folders = def.folders!;
    if (def.mode === 'worktree') {
      const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: folders[0], windowsHide: true, timeout: 15000 });
      const root = stdout.trim();
      const target = path.resolve(this.service.store.root, 'worktrees', run.id);
      if (!target.startsWith(path.resolve(this.service.store.root) + path.sep)) throw new Error('Invalid worktree destination.');
      const branch = 'ailo/task-' + run.id;
      await exec('git', ['worktree', 'add', '-b', branch, target, 'HEAD'], { cwd: root, windowsHide: true, timeout: 60000 });
      run.worktreePath = target; run.branch = branch; folders = [target]; this.publish();
    }
    if (run.status !== 'queued' || this.stopping) return;
    const c = this.service.createConversation({ accountId: def.accountId, folders, title: `${def.name} · ${new Date(run.startedAt).toLocaleString()}`, tools: { connectionIds: [], skillIds: [], pluginIds: [] } });
    c.toolSnapshot = run.tools;
    c.executionMode = def.mode; c.automationRunId = run.id;
    run.conversationId = c.id;
    this.publish();
    if (Object.values(def.options).some((v) => v !== undefined && v !== '')) await this.service.setConversationOptions(c.id, def.options);
    if (run.status !== 'queued' || this.stopping) return;
    this.timers.set(run.id, setTimeout(() => { run.message = 'Task stopped after its time limit.'; void this.stop(run.id); }, def.timeoutMinutes * 60000));
    const result = await this.service.sendMessage(c.id, def.prompt);
    if (!result.ok) this.finish(run, 'blocked', result.conflicts?.length ? 'Another conversation is using this working folder. Run again when it finishes, or choose Worktree.' : result.error ?? 'Could not start the task.');
  }

  conversationChanged(c: Conversation): void {
    const run = this.state.automationRuns.find((r) => r.id === c.automationRunId);
    if (!run || !active.has(run.status)) return;
    if (c.status === 'running') run.status = 'running';
    else if (c.status === 'awaiting_input') run.status = 'needs_attention';
    else {
      run.summary = this.service.store.transcript(c.id).items.filter((i) => i.kind === 'assistant').map((i) => i.text).join('\n').slice(-4000);
      this.finish(run, c.status === 'idle' ? 'completed' : c.status === 'interrupted' ? 'interrupted' : 'failed', c.lastError ?? run.message);
    }
  }

  private finish(run: AutomationRun, status: AutomationRun['status'], message?: string): void {
    if (!active.has(run.status) && run.finishedAt) return;
    clearTimeout(this.timers.get(run.id)); this.timers.delete(run.id);
    run.status = status; run.message = message; run.finishedAt = new Date().toISOString(); this.publish();
  }

  async stop(id: string): Promise<void> {
    const run = this.state.automationRuns.find((r) => r.id === id);
    if (!run || !active.has(run.status)) return;
    this.finish(run, 'interrupted', run.message ?? 'Task stopped by the user.');
    if (run.conversationId) await this.service.stop(run.conversationId);
  }
  removeRun(id: string): void {
    if (this.state.automationRuns.some((r) => r.id === id && active.has(r.status))) throw new Error('Stop the execution before removing its result.');
    this.state.automationRuns = this.state.automationRuns.filter((r) => r.id !== id);
    this.publish();
  }

  async tick(clock = new Date(), recovering = false): Promise<void> {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    const resuming = recovering || (this.lastTick !== undefined && clock.getTime() - this.lastTick > 45000);
    this.lastTick = clock.getTime();
    try {
      for (const def of this.state.automations) {
        if (!def.enabled || !def.nextRunAt || Date.parse(def.nextRunAt) > clock.getTime()) continue;
        const scheduledAt = def.nextRunAt;
        def.nextRunAt = nextScheduledRun(def.schedule, clock);
        const exists = this.state.automationRuns.some((r) => r.automationId === def.id && r.scheduledAt === scheduledAt);
        if (exists) { this.publish(); continue; }
        const busy = this.state.automationRuns.some((r) => r.automationId === def.id && active.has(r.status));
        if (resuming || clock.getTime() - Date.parse(scheduledAt) > 120000 || busy) {
          this.state.automationRuns.push({ id: randomUUID(), automationId: def.id, definition: structuredClone(def), trigger: 'scheduled', scheduledAt, status: 'missed', message: busy ? 'Skipped because the previous run is still active.' : 'Ailo was not active at the scheduled time. Use Run now to run it once.', startedAt: clock.toISOString(), finishedAt: clock.toISOString() });
          this.publish();
        } else {
          this.publish(); await this.run(def.id, 'scheduled', scheduledAt);
        }
      }
    } finally { this.ticking = false; }
  }

  startScheduler(): void {
    for (const run of this.state.automationRuns) if (active.has(run.status)) this.finish(run, 'interrupted', 'The previous execution ended when Ailo closed. Run the task again to start a fresh execution.');
    void this.tick(new Date(), true).catch(() => {});
    this.interval = setInterval(() => void this.tick().catch(() => {}), 15000);
  }
  shutdown(): void {
    this.stopping = true; clearInterval(this.interval);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
