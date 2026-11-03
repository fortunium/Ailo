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

const suite=process.env.AILO_IT_CODEX ? describe : describe.skip;
suite('Codex native integration configuration (no inference)',()=>{
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
   const thread=await third.rpc.request('thread/start',{cwd,approvalPolicy:'on-request',sandbox:'read-only',config:{[`plugins.${JSON.stringify(codexPluginId(plugin))}.enabled`]:true}});expect(thread.thread.id).toBeTruthy();
  } finally{await adapter.dispose();}
 },30000);
});
