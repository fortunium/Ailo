import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexAdapter } from '../src/main/providers/codex';
import { codexMcpConfig, connectionName, importLocalPlugin } from '../src/main/integrations';
import { installCodexPlugins, codexPluginId } from '../src/main/providers/codex-plugins';
import { detectCli } from '../src/main/cli';
import type { Account, McpConnection } from '../src/shared/types';
import type { RunCallbacks } from '../src/main/providers/types';

const suite=process.env.AILO_IT_CODEX ? describe : describe.skip;
suite('Codex native integration configuration (no inference)',()=>{
 it.each([false, true])('uses an inherited MCP under its original name (selected=%s)', async selected => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailo-mcp-override-'));
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  const originalConfig = `[mcp_servers.datadog]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(path.resolve('test/fixtures/mcp-server.mjs'))}]\n`;
  fs.writeFileSync(path.join(home, 'config.toml'), originalConfig);
  const adapter = new CodexAdapter();
  const account: Account = { id: randomUUID(), alias: 'Native MCP fixture', provider: 'codex', createdAt: '', color: '#000', connection: { state: 'unknown' } };
  try {
   const server = await (adapter as any).server(account, home);
   expect(await adapter.listAccountMcp(account, home)).toEqual([{ name: 'datadog', transport: 'stdio', enabled: true }]);
   server.ensureSandbox = async () => {};
   const request = server.rpc.request.bind(server.rpc);
   server.rpc.request = (method: string, params: any) => method === 'turn/start' ? Promise.resolve({ turn: { id: 'no-inference' } }) : request(method, params);
   let threadId = '';
   const cb: RunCallbacks = { onSession: id => { threadId = id; }, onItem() {}, onDelta() {}, onLog() {}, onUsage() {}, onContext() {}, requestApproval: async () => 'deny', requestAnswers: async () => null };
   await server.startTurn({ account, home, cwd: root, extraDirs: [], text: 'Fixture', attachments: [], options: {}, tools: { connections: [], skills: [], plugins: [], accountMcpNames: selected ? ['datadog'] : [] }, cb });
   expect(threadId).toBeTruthy();
   let result = await request('mcpServerStatus/list', { threadId });
   if (selected) for (let i = 0; i < 50 && !Object.keys(result.data.find((s: any) => s.name === 'datadog')?.tools ?? {}).length; i++) {
    await new Promise(resolve => setTimeout(resolve, 100)); result = await request('mcpServerStatus/list', { threadId });
   }
   expect(result.data.map((s: any) => s.name)).not.toContain('"datadog"');
   expect(Object.keys(result.data.find((s: any) => s.name === 'datadog')?.tools ?? {}).length > 0).toBe(selected);
   expect(fs.readFileSync(path.join(home, 'config.toml'), 'utf8')).toBe(originalConfig);
  } finally { await adapter.dispose(); }
 }, 15000);
 it('renders command output deltas before the command completes', async () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ailo-progress-'));
  const adapter=new CodexAdapter();
  const account:Account={id:randomUUID(),alias:'Progress fixture',provider:'codex',createdAt:'',color:'#000',connection:{state:'unknown'}};
  try {
   const server=await (adapter as any).server(account,home,'fixture');
   const items:any[]=[];
   server.turns.set('fixture',{output:new Map(),items:new Map(),cb:{onItem:(item:any)=>items.push(item)}});
   const command={id:'command',type:'commandExecution',command:'echo fixture',status:'inProgress'};
   server.onNotification('item/started',{threadId:'fixture',item:command});
   server.onNotification('item/commandExecution/outputDelta',{threadId:'fixture',itemId:'command',delta:'first line\n'});
   expect(items.at(-1)).toMatchObject({id:'command',status:'running',output:'first line\n'});
   server.onNotification('item/commandExecution/outputDelta',{threadId:'fixture',itemId:'command',delta:'second line\n'});
   expect(items.at(-1).output).toBe('first line\nsecond line\n');
   server.onNotification('item/completed',{threadId:'fixture',item:{...command,status:'completed',aggregatedOutput:'final authoritative output'}});
   expect(items.at(-1)).toMatchObject({id:'command',status:'done',output:'final authoritative output'});
   server.turns.delete('fixture');
  } finally { await adapter.dispose(); }
 },15000);
 it('isolates two MCP profiles on the same account home and loads a pinned local plugin',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ailo-native-'));const home=path.join(root,'home');const cwd=path.join(root,'project');fs.mkdirSync(cwd);
  const adapter=new CodexAdapter();const account:Account={id:randomUUID(),alias:'Isolated native fixture',provider:'codex',createdAt:'',color:'#000',connection:{state:'unknown'}};
  const connection=(id:string):McpConnection=>({id,name:id,identity:'Fixture',transport:'stdio',command:process.execPath,args:[path.resolve('test/fixtures/mcp-server.mjs')],providers:['codex'],createdAt:''});
  const a=connection('profile_a'),b=connection('profile_b');
  try{
   const first=await (adapter as any).server(account,home,'a');
   const second=await (adapter as any).server(account,home,'b');
   const t1=await first.rpc.request('thread/start',{cwd,approvalPolicy:'on-request',sandbox:'read-only',config:codexMcpConfig({connections:[a],skills:[],plugins:[]},{})});
   const t2=await second.rpc.request('thread/start',{cwd,approvalPolicy:'on-request',sandbox:'read-only',config:codexMcpConfig({connections:[b],skills:[],plugins:[]},{})});
   const status=async(server:any,id:string)=>{for(let i=0;i<50;i++){const r=await server.rpc.request('mcpServerStatus/list',{threadId:id});if(r.data?.some((s:any)=>s.tools&&Object.keys(s.tools).length))return r.data;await new Promise(r=>setTimeout(r,100));}throw Error('MCP tools did not become available');};
   const [s1,s2]=await Promise.all([status(first,t1.thread.id),status(second,t2.thread.id)]);
   expect(s1.map((s:any)=>s.name)).toContain(connectionName(a.id));expect(s1.map((s:any)=>s.name)).not.toContain(connectionName(b.id));expect(s2.map((s:any)=>s.name)).toContain(connectionName(b.id));
   expect(fs.readFileSync(path.join(home,'config.toml'),'utf8')).not.toContain('profile_a');
   const pluginSource=path.join(root,'source');fs.mkdirSync(path.join(pluginSource,'.codex-plugin'),{recursive:true});fs.mkdirSync(path.join(pluginSource,'skills','fixture'),{recursive:true});fs.writeFileSync(path.join(pluginSource,'.codex-plugin','plugin.json'),JSON.stringify({name:'fixture-plugin',version:'1.0.0',description:'Fixture',skills:'./skills/'}));fs.writeFileSync(path.join(pluginSource,'skills','fixture','SKILL.md'),'---\nname: fixture\ndescription: Fixture instructions\n---\nSay fixture.\n');
   const plugin=importLocalPlugin(root,pluginSource);const cli=await detectCli('codex');const ids=await installCodexPlugins(cli.path!,home,[plugin]);expect(ids).toContain(codexPluginId(plugin));
   const third=await (adapter as any).server(account,home,'plugin');
   const thread=await third.rpc.request('thread/start',{cwd,approvalPolicy:'on-request',sandbox:'read-only',config:{plugins:{[codexPluginId(plugin)]:{enabled:true}}}});expect(thread.thread.id).toBeTruthy();
  } finally{await adapter.dispose();}
 },30000);
});
