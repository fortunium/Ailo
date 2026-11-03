import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { detectCli } from '../src/main/cli';
import { providerEnv } from '../src/main/env';
import { claudeMcpConfig, connectionName, importLocalPlugin, pluginMcpConfig } from '../src/main/integrations';

const suite = process.env.AILO_IT_CLAUDE_CONFIG ? describe : describe.skip;
suite('Claude native configuration (no inference)',()=>{
 it('loads an explicit MCP connection and a pinned plugin without a model prompt',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ailo-claude-config-'));const home=path.join(root,'home');fs.mkdirSync(home);const cli=await detectCli('claude');if(!cli.path)throw Error('Claude CLI missing');
  const source=path.join(root,'source');fs.mkdirSync(path.join(source,'.claude-plugin'),{recursive:true});fs.mkdirSync(path.join(source,'skills','fixture'),{recursive:true});fs.writeFileSync(path.join(source,'.claude-plugin','plugin.json'),JSON.stringify({name:'fixture-plugin',version:'1.0.0',description:'Fixture'}));fs.writeFileSync(path.join(source,'skills','fixture','SKILL.md'),'---\nname: fixture\ndescription: Fixture\n---\nSay fixture.\n');fs.writeFileSync(path.join(source,'.mcp.json'),JSON.stringify({mcpServers:{docs:{command:process.execPath,args:[path.resolve('test/fixtures/mcp-server.mjs')],env:{PLUGIN_PATH:'${CLAUDE_PLUGIN_ROOT}'}}}}));const plugin=importLocalPlugin(root,source);
  const connection={id:'native_fixture',name:'Fixture',identity:'Public',transport:'stdio' as const,command:process.execPath,args:[path.resolve('test/fixtures/mcp-server.mjs')],providers:['claude' as const],createdAt:''};
  let release!:()=>void;const held=new Promise<void>(r=>release=r);async function* empty():AsyncGenerator<SDKUserMessage>{await held;}
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),20000);
  const q=query({prompt:empty(),options:{env:providerEnv('claude',home),pathToClaudeCodeExecutable:cli.path,cwd:root,settingSources:[],strictMcpConfig:true,mcpServers:{...pluginMcpConfig([plugin]),...claudeMcpConfig({connections:[connection],skills:[],plugins:[]},{})},pluginDelivery:'initialize',plugins:[{type:'local',path:plugin.path,skipMcpDiscovery:true}],permissionMode:'default',abortController:abort}});
  try {
   const init=await q.initializationResult();expect(init.plugins_applied).toBe(true);
   let status=await q.mcpServerStatus();for(let i=0;i<30&&!status.some(s=>s.status==='connected');i++){await new Promise(r=>setTimeout(r,100));status=await q.mcpServerStatus();}
   expect(status.map(s=>s.name)).toContain('plugin_fixture-plugin_docs');expect(status.map(s=>s.name)).toContain(connectionName(connection.id));expect(status.find(s=>s.name===connectionName(connection.id))?.status).toBe('connected');
   const models=await q.supportedModels();expect(models.length).toBeGreaterThan(0);
  } finally {clearTimeout(timer);release();q.close();}
 },30000);
});
