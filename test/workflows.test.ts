import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { Store } from '../src/main/store';
import { AiloService } from '../src/main/service';
import { SecretVault } from '../src/main/secrets';
import { nextScheduledRun } from '../src/main/automations';
import { codexMcpConfig, claudeMcpConfig, probeConnection } from '../src/main/integrations';
import type { ProviderAdapter, RunOutcome, RunParams } from '../src/main/providers/types';
import type { AutomationInput, McpConnection } from '../src/shared/types';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ailo-workflow-test-'));
const wait = async (until: () => boolean) => { for (let i = 0; i < 100; i++) { if (until()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Condition did not become true'); };
const none = () => ({ connectionIds: [], skillIds: [], pluginIds: [] });
function setup() {
 const root = temp(); const key = randomBytes(32);
 const vault = new SecretVault(root, text => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); }, data => { const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0,12)); decipher.setAuthTag(data.subarray(-16)); return Buffer.concat([decipher.update(data.subarray(12,-16)), decipher.final()]).toString(); });
 const params: RunParams[] = []; const finish = new Map<string, (o: RunOutcome) => void>();
 let connected = true; let exhausted = false;
 const adapter: ProviderAdapter = { id: 'codex', initHome: h => { fs.mkdirSync(h,{recursive:true}); }, checkAccount: async()=> connected ? {state:'connected',checkedAt:''} : {state:'signed_out',checkedAt:''}, startLogin: async()=>({done:Promise.resolve(),submitCode(){},cancel(){}}), logout:async()=>{}, dispose:async()=>{},
  listModels:async()=>({models:[{id:'fixture',label:'Fixture',efforts:['low'],fast:false,isDefault:true}],fastNote:''}),getUsage:async()=>({source:'official',updatedAt:new Date().toISOString(),windows:[{label:'5-hour',usedPercent:exhausted?100:12}]}),deleteSession:async()=>true,
  runTurn:async(p)=> { params.push(p); const sid='fixture-'+params.length;p.cb.onSession(sid);return {done:new Promise(r=>finish.set(sid,r)),stop:async()=>finish.get(sid)?.({status:'interrupted'})}; }
 };
 const store=new Store(root);const svc=new AiloService(store,{codex:adapter,claude:{...adapter,id:'claude'}},()=>{},()=>{},vault);
 const account=svc.addAccount({provider:'codex',alias:'Work',color:'#000'}); const folder=temp();
 const input:AutomationInput={name:'Review',prompt:'Inspect the project',accountId:account.id,folders:[folder],options:{},tools:none(),mode:'report',enabled:false,timeoutMinutes:5,schedule:{frequency:'manual',time:'09:00',timeZone:'Europe/Amsterdam',weekday:1}};
 return {svc,store,vault,params,finish,account,input,folder,setConnected:(v:boolean)=>{connected=v;},setExhausted:(v:boolean)=>{exhausted=v;}};
}

describe('Scheduling and run lifecycle',()=>{
 it('schedules by local weekday and timezone, including DST transitions',()=>{
  const schedule={frequency:'weekdays' as const,time:'09:00',timeZone:'Europe/Amsterdam',weekday:1};
  expect(nextScheduledRun(schedule,new Date('2026-03-27T09:00:00Z'))).toBe('2026-03-30T07:00:00.000Z');
  expect(nextScheduledRun(schedule,new Date('2026-10-23T08:00:00Z'))).toBe('2026-10-26T08:00:00.000Z');
  expect(()=>nextScheduledRun({...schedule,timeZone:'invalid'},new Date())).toThrow();
 });
 it('starts a fresh linked conversation for every execution and records completion',async()=>{
  const {svc,input,params,finish}=setup();const a=svc.automations.save(input);const r=await svc.automations.run(a.id);
  await wait(()=>params.length===1);expect(r.status).toBe('running');expect(params[0].mode).toBe('report');
  params[0].cb.onItem({kind:'assistant',id:'answer',text:'All clear',at:''});finish.get('fixture-1')!({status:'completed'});
  await wait(()=>r.status==='completed');expect(r.summary).toBe('All clear');
  const r2=await svc.automations.run(a.id);await wait(()=>params.length===2);expect(r2.conversationId).not.toBe(r.conversationId);await svc.dispose();
 });
 it('blocks signed-out and exhausted accounts without falling back',async()=>{
  for(const reason of ['auth','usage']){const {svc,input,params,setConnected,setExhausted}=setup();if(reason==='auth')setConnected(false);else setExhausted(true);
   const a=svc.automations.save(input);const r=await svc.automations.run(a.id);await wait(()=>r.status==='blocked');expect(params).toHaveLength(0);expect(r.conversationId).toBeUndefined();await svc.dispose();}
 });
 it('records an overdue schedule once and never runs its backlog',async()=>{
  const {svc,input,params}=setup();const a=svc.automations.save({...input,enabled:true,schedule:{...input.schedule,frequency:'daily'}},new Date('2026-11-01T00:00:00Z'));
  await svc.automations.tick(new Date('2026-11-04T20:00:00Z'));await svc.automations.tick(new Date('2026-11-04T20:00:00Z'));
  expect(svc.state.automationRuns).toHaveLength(1);expect(svc.state.automationRuns[0].status).toBe('missed');expect(params).toHaveLength(0);expect(a.nextRunAt).toBe('2026-11-05T08:00:00.000Z');await svc.dispose();
 });
 it('claims a due slot once and prevents overlapping executions',async()=>{
  const {svc,input,params}=setup();const a=svc.automations.save({...input,enabled:true,schedule:{...input.schedule,frequency:'daily'}},new Date('2026-11-01T00:00:00Z'));
  await svc.automations.tick(new Date('2026-11-01T08:00:10Z'));await svc.automations.tick(new Date('2026-11-01T08:00:20Z'));await wait(()=>params.length===1);
  expect(svc.state.automationRuns).toHaveLength(1);await expect(svc.automations.run(a.id)).rejects.toThrow('active run');await svc.dispose();
 });
 it('marks a permission prompt as needing attention and safely stops it',async()=>{
  const {svc,input,params}=setup();const a=svc.automations.save({...input,mode:'workspace'});const r=await svc.automations.run(a.id);await wait(()=>params.length===1);
  const decision=params[0].cb.requestApproval({title:'Need permission',allowSession:false});await wait(()=>r.status==='needs_attention');await svc.automations.stop(r.id);expect(await decision).toBe('cancelled');expect(r.status).toBe('interrupted');await svc.dispose();
 });
 it('cancels queued startup before any provider turn can begin',async()=>{
  const {svc,input,params}=setup();const a=svc.automations.save(input);const r=await svc.automations.run(a.id);await svc.automations.stop(r.id);await new Promise(r=>setTimeout(r,20));expect(params).toHaveLength(0);expect(r.status).toBe('interrupted');await svc.dispose();
 });
 it('uses a separate Git worktree and keeps generated work for review',async()=>{
  const {svc,input,folder,params}=setup();execFileSync('git',['init'],{cwd:folder,stdio:'ignore'});fs.writeFileSync(path.join(folder,'original.txt'),'original');execFileSync('git',['add','.'],{cwd:folder});execFileSync('git',['-c','user.name=Ailo Test','-c','user.email=test@example.invalid','commit','-m','fixture'],{cwd:folder,stdio:'ignore'});
  const a=svc.automations.save({...input,mode:'worktree'});const r=await svc.automations.run(a.id);await wait(()=>params.length===1);expect(params[0].cwd).not.toBe(folder);fs.writeFileSync(path.join(params[0].cwd,'original.txt'),'changed');expect(fs.readFileSync(path.join(folder,'original.txt'),'utf8')).toBe('original');await svc.automations.stop(r.id);expect(fs.existsSync(r.worktreePath!)).toBe(true);await svc.dispose();
 });
});

describe('Integration identity and persistence',()=>{
 it('stores credential references in state and freezes selected instructions per conversation',async()=>{
  const {svc,store,params,vault,account}=setup();const c=await svc.saveConnection({name:'External work',identity:'Work user',transport:'stdio',command:'node',providers:['codex'],credentials:{env:{SERVICE_TOKEN:'test-secret-1234'}}});
  const skill=svc.saveSkill({name:'Review style',instructions:'Original instructions'});const conversation=svc.createConversation({accountId:account.id,tools:{connectionIds:[c.id],skillIds:[skill.id],pluginIds:[]}});
  svc.saveSkill({id:skill.id,name:skill.name,instructions:'Edited instructions'});expect(conversation.toolSnapshot!.skills[0].instructions).toBe('Original instructions');
  expect(fs.readFileSync(store.statePath,'utf8')).not.toContain('test-secret-1234');expect(fs.readFileSync(path.join(store.root,'secrets',c.credentialId!+'.bin')).includes(Buffer.from('test-secret-1234'))).toBe(false);expect((await vault.get(c.credentialId!)).env!.SERVICE_TOKEN).toBe('test-secret-1234');
  await svc.sendMessage(conversation.id,'hello');await wait(()=>params.length===1);expect(params[0].credentials![c.id].env!.SERVICE_TOKEN).toBe('test-secret-1234');params[0].cb.onLog('Failure: test-secret-1234');expect(store.transcript(conversation.id).log.join('')).not.toContain('test-secret-1234');await svc.dispose();
 });
 it('requires a new selection after external credentials change',async()=>{
  const {svc,account,params}=setup();const c=await svc.saveConnection({name:'Work',identity:'Work',transport:'http',url:'https://example.invalid/mcp',providers:['codex'],credentials:{bearerToken:'old-token'}});const conversation=svc.createConversation({accountId:account.id,tools:{connectionIds:[c.id],skillIds:[],pluginIds:[]}});
  await svc.saveConnection({...c,id:c.id,credentials:{bearerToken:'new-token'}});await svc.sendMessage(conversation.id,'hello',{wait:true});expect(params).toHaveLength(0);expect(conversation.lastError).toContain('Credentials');await svc.dispose();
 });
 it('validates report mode and provider compatibility before saving',async()=>{
  const {svc,input}=setup();const c=await svc.saveConnection({name:'Only Claude',identity:'Public',transport:'http',url:'https://example.invalid/mcp',providers:['claude']});
  expect(()=>svc.automations.save({...input,tools:{connectionIds:[c.id],skillIds:[],pluginIds:[]}})).toThrow('provider');
  const c2=await svc.saveConnection({name:'Both',identity:'Public',transport:'http',url:'https://example.invalid/mcp',providers:['codex']});expect(()=>svc.automations.save({...input,tools:{connectionIds:[c2.id],skillIds:[],pluginIds:[]}})).toThrow('Report mode');await svc.dispose();
 });
 it('discovers tools from a real local MCP process without making a model call',async()=>{
  const connection:McpConnection={id:'fixture',name:'Fixture',identity:'Public',transport:'stdio',command:process.execPath,args:[path.resolve('test/fixtures/mcp-server.mjs')],providers:['codex','claude'],createdAt:''};
  const result=await probeConnection(connection,{});expect(result.ok,result.error).toBe(true);expect(result.tools.map(t=>t.name)).toEqual(['read_example','other_example']);
  const tools={connections:[connection],skills:[],plugins:[]};expect(codexMcpConfig(tools,{})).toHaveProperty('mcp_servers.ailo_fixture');expect(claudeMcpConfig(tools,{})).toHaveProperty('ailo_fixture');
 });
 it('imports an immutable local plugin copy without running its hooks',async()=>{
  const {svc}=setup();const root=temp();fs.mkdirSync(path.join(root,'.claude-plugin'));fs.writeFileSync(path.join(root,'.claude-plugin','plugin.json'),JSON.stringify({name:'example',version:'1.0.0',description:'fixture'}));fs.mkdirSync(path.join(root,'skills'));fs.writeFileSync(path.join(root,'skills','SKILL.md'),'Original');const plugin=svc.importPlugin(root);fs.writeFileSync(path.join(root,'skills','SKILL.md'),'Changed');expect(fs.readFileSync(path.join(plugin.path,'skills','SKILL.md'),'utf8')).toBe('Original');expect(plugin.providers).toEqual(['claude','codex']);expect(plugin.digest).toHaveLength(64);await svc.dispose();
 });
 it('migrates existing state files with empty workflow collections',()=>{
  const root=temp();fs.writeFileSync(path.join(root,'state.json'),JSON.stringify({accounts:[],projects:[],conversations:[],settings:{theme:'dark'}}));const state=new Store(root).state;expect(state.automations).toEqual([]);expect(state.connections).toEqual([]);expect(state.plugins).toEqual([]);expect(state.settings.theme).toBe('dark');
 });
});


describe('Automation recovery and execution boundaries',()=>{
 it('stops a running task at its configured deadline',async()=>{
  const {svc,input,params}=setup();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try{const a=svc.automations.save({...input,timeoutMinutes:1});const run=await svc.automations.run(a.id);for(let i=0;i<30&&params.length===0;i++)await Promise.resolve();expect(params).toHaveLength(1);await vi.advanceTimersByTimeAsync(60001);expect(run.status).toBe('interrupted');expect(run.message).toContain('time limit');}
  finally{await svc.dispose();vi.useRealTimers();}
 });
 it('pins connection definitions before asynchronous startup',async()=>{
  const {svc,input}=setup();const connection=await svc.saveConnection({name:'Original external identity',identity:'Work',transport:'http',url:'https://example.invalid/mcp',providers:['codex']});const a=svc.automations.save({...input,mode:'workspace',tools:{connectionIds:[connection.id],skillIds:[],pluginIds:[]}});const run=await svc.automations.run(a.id);await svc.saveConnection({...connection,name:'Renamed connection'});expect(run.tools!.connections[0].name).toBe('Original external identity');await svc.automations.stop(run.id);await svc.dispose();
 });
 it('denies report-mode approvals without waiting for unattended input',async()=>{
  const {svc,input,params}=setup();const a=svc.automations.save(input);const run=await svc.automations.run(a.id);await wait(()=>params.length===1);expect(await params[0].cb.requestApproval({title:'Write outside report scope',allowSession:true})).toBe('deny');expect(run.status).toBe('running');await svc.dispose();
 });
 it('marks unfinished executions interrupted after a restart',async()=>{
  const {svc,input}=setup();const a=svc.automations.save(input);await svc.automations.run(a.id);const saved=JSON.stringify(svc.state);await svc.dispose();const root=temp();fs.writeFileSync(path.join(root,'state.json'),saved);const revived=new AiloService(new Store(root),(svc as any).adapters,()=>{});revived.automations.startScheduler();expect(revived.state.automationRuns[0].status).toBe('interrupted');revived.automations.shutdown();await revived.dispose();
 });
});


it('does not catch up even a recently missed slot after startup',async()=>{
 const {svc,input,params}=setup();const a=svc.automations.save({...input,enabled:true,schedule:{...input.schedule,frequency:'daily'}});a.nextRunAt=new Date(Date.now()-1000).toISOString();svc.automations.startScheduler();await wait(()=>svc.state.automationRuns.length===1);expect(svc.state.automationRuns[0].status).toBe('missed');expect(params).toHaveLength(0);await svc.dispose();
});
