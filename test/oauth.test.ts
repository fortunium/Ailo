import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { authorizeMcp, refreshMcpToken } from '../src/main/oauth';

describe('MCP OAuth',()=>{
 it('uses PKCE, rejects a forged callback and keeps tokens for the correct connection',async()=>{
  let base='';let challenge='';let badCallbackStatus=0;let exchanged=false;
  const server=http.createServer(async(req,res)=>{
   const url=new URL(req.url!,'http://localhost');let body='';for await(const part of req)body+=part;
   res.setHeader('Content-Type','application/json');
   if(url.pathname.startsWith('/.well-known/oauth-protected-resource'))return res.end(JSON.stringify({resource:base+'/mcp',authorization_servers:[base]}));
   if(url.pathname.startsWith('/.well-known/oauth-authorization-server')||url.pathname.startsWith('/.well-known/openid-configuration'))return res.end(JSON.stringify({issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',registration_endpoint:base+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']}));
   if(url.pathname==='/register')return res.end(JSON.stringify({...JSON.parse(body),client_id:'fixture-client'}));
   if(url.pathname==='/token'){
    const fields=new URLSearchParams(body);
    if(fields.get('grant_type')==='authorization_code'){
     const actual=createHash('sha256').update(fields.get('code_verifier')!).digest('base64url');
     if(actual!==challenge){res.statusCode=400;return res.end(JSON.stringify({error:'invalid_grant'}));}
     exchanged=true;
    }
    return res.end(JSON.stringify({access_token:fields.get('grant_type')==='refresh_token'?'refreshed-token':'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600}));
   }
   res.statusCode=404;res.end('{}');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No port');base=`http://127.0.0.1:${address.port}`;
  let browserTask:Promise<void>|undefined;
  try{
   const credentials=await authorizeMcp(base+'/mcp',{},url=>{
    browserTask=(async()=>{const authorization=new URL(url);challenge=authorization.searchParams.get('code_challenge')!;const callback=new URL(authorization.searchParams.get('redirect_uri')!);callback.searchParams.set('state','forged');callback.searchParams.set('code','fixture-code');badCallbackStatus=(await fetch(callback)).status;callback.searchParams.set('state',authorization.searchParams.get('state')!);await fetch(callback);})();
   });
   await browserTask;expect(badCallbackStatus).toBe(400);expect(exchanged).toBe(true);expect(credentials.oauth?.tokens?.access_token).toBe('fixture-access');
   credentials.oauth!.expiresAt=0;
   // The provider refreshes expired tokens without opening a browser.
   const refreshed=await refreshMcpToken(base+'/mcp',{...credentials,oauth:{...credentials.oauth!,tokens:{...credentials.oauth!.tokens!,expires_in:0}}});
   expect(refreshed.oauth?.tokens?.access_token).toBe('refreshed-token');
  }finally{server.close();server.closeAllConnections();}
 },20000);
});
