// Actual loopback HTTP / Next Server Actions. No browser, live account, or provider.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'telegram-harness-phase3-'));
const api='http://127.0.0.1:18788',web='http://127.0.0.1:13006',key='synthetic-phase3-http-key';
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,API_KEY:key,TELEGRAM_CRM_DB_PATH:join(dir,'fixture.sqlite'),PORT:'18788',TELEGRAM_LOCAL_UI:'true',TELEGRAM_HARNESS_API_URL:api,NEXT_TELEMETRY_DISABLED:'1'};
const children=[];
function start(args){const child=spawn('pnpm',args,{env,stdio:['ignore','pipe','pipe'],detached:true});children.push(child);child.stdout.resume();child.stderr.resume();}
async function ready(url){for(let i=0;i<100;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,150));}throw Error(`not ready: ${url}`);}
async function call(path,body){const r=await fetch(`${api}/api/crm/${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.ok,true,`${path}: ${r.status} ${r.ok?'':await r.text()}`);return r.json();}
async function html(kind,extra=''){const response=await fetch(`${web}/crm/engagement?kind=${kind}${extra}`);assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes(key),'no management key in HTML');return text;}
async function submit(kind,operation,values,extra=''){
  const text=await html(kind,extra);const form=[...text.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(x=>x[0]).find(x=>x.includes(`name="operation" value="${operation}"`));assert.ok(form,`form ${operation}`);
  const action=form.match(/name="(\$ACTION_ID_[^"]+)"/);assert.ok(action,'server action marker');const data=new FormData();for(const[k,v]of Object.entries({[action[1]]:'',operation,...values}))data.set(k,v);
  const r=await fetch(`${web}/crm/engagement`,{method:'POST',headers:{origin:web},body:data,redirect:'manual'});assert.equal(r.status,303);
  const location=decodeURIComponent(r.headers.get('location'));assert.ok(location.includes('保存しました')||location.includes('モック処理:'),location);return location;
}
try {
  start(['--filter','worker','dev']);start(['--filter','web','exec','next','start','--hostname','127.0.0.1','--port','13006']);
  await Promise.all([ready(`${api}/api/health`),ready(`${web}/crm/engagement`)]);
  const c=(await call('customers',{displayName:'フェーズ3 HTTP合成顧客',source:'store',tags:['VIP']})).data;
  const contact=(await call(`customers/${c.id}/contacts`,{kind:'telegram',value:'900001',scope:'demo'})).data;
  await call(`contacts/${contact.id}/verify`,{evidence:'synthetic'});await call(`contacts/${contact.id}/consents`,{purpose:'marketing',status:'granted',policyVersion:'v1',evidence:'synthetic',occurredAt:new Date().toISOString()});
  await submit('profiles','profiles',{requestKey:'profile',customerId:c.id,industry:'bar',field_preferredStaff:'スタッフA',field_bottle:'B-01',serviceConsent:'granted',consentEvidence:'synthetic',policyVersion:'v1',ageStatus:'verified',ageYears:'25',ageEvidence:'synthetic staff check'},'&industry=bar');
  await submit('visits','visits',{requestKey:'visit',customerId:c.id,occurredAt:new Date().toISOString(),staff:'スタッフA',nomination:'指定',course:'standard',bottle:'B-01',amountMinor:'5000',currency:'JPY',alcohol:'true',notes:'HTTP合成来店'});
  for(const source of ['manual','webhook-mock'])await submit('calls','calls',{requestKey:source,customerId:c.id,direction:source==='manual'?'incoming':'outgoing',source,occurredAt:new Date().toISOString(),number:'+819000000001',notes:'HTTP合成通話'});
  await submit('videos','videos',{requestKey:'video',title:'HTTP合成動画',mode:'telegram',url:'https://example.com/synthetic.mp4'});
  await submit('video-events','video-events',{requestKey:'view',customerId:c.id,videoId:'video',event:'self_reported_watched',occurredAt:new Date().toISOString(),evidence:'synthetic self-report, not measured playback'});
  await submit('scenarios','scenarios',{requestKey:'scenario',name:'HTTP合成シナリオ',botId:'demo',steps:JSON.stringify([{delayMinutes:0,message:{kind:'video',videoId:'video'},condition:{field:'tag',op:'eq',value:'VIP'},onTrue:1,onFalse:null},{delayMinutes:0,message:{kind:'text',text:'HTTP follow-up'},onTrue:null,onFalse:null}])});
  await submit('executions','enrollments',{scenarioId:'scenario',contactId:contact.id});
  await submit('executions','run',{});await submit('executions','run',{});
  let executions=(await call('engagement/executions')).data;assert.equal(executions.length,1);assert.equal(executions[0].state,'completed');assert.equal(executions[0].data.history[0].payload.method,'sendVideo');assert.equal(executions[0].data.history.length,2);
  await submit('segments','segments',{requestKey:'segment',name:'HTTP VIP',botId:'demo',rules:JSON.stringify([{field:'tag',op:'eq',value:'VIP'}])});
  assert.ok((await html('segments','&segmentId=segment')).includes('配信可能（モック）'));
  await submit('campaigns','campaigns',{requestKey:'campaign',segmentId:'segment',dueAt:new Date().toISOString(),messageText:'HTTP segment message'});
  await submit('executions','run',{});executions=(await call('engagement/executions')).data;assert.equal(executions.filter(x=>x.state==='completed').length,2);
  await submit('campaigns','campaigns',{requestKey:'stop-campaign',segmentId:'segment',dueAt:new Date(Date.now()+86400000).toISOString(),messageText:'will stop'});
  const stopping=(await call('engagement/executions')).data.find(x=>x.state==='active');await submit('executions','executions/stop',{executionId:stopping.id});assert.equal((await call('engagement/executions')).data.find(x=>x.id===stopping.id).state,'stopped');
  assert.equal((await call('engagement/records/calls')).data.length,2);assert.equal((await call('engagement/records/visits')).data[0].data.staff,'スタッフA');assert.equal((await call('engagement/records/video-events')).data[0].data.verifiedPlayback,false);
  for(const kind of ['executions','profiles','visits','calls','videos','video-events','segments','scenarios','campaigns'])assert.ok((await html(kind)).includes('配信・業種別台帳'));
  const text=await html('executions');const css=[...text.matchAll(/href="([^" ]+\.css[^" ]*)"/g)].map(x=>x[1]);assert.ok(css.length);for(const path of css)assert.equal((await fetch(new URL(path,web))).status,200);
  console.log('PASS: 9 Kumo tabs, Next form actions → industry/age/consent → visit/calls (both ingress modes) → video/events → branched scenario → segment preview/campaign → mock execution/stop; CSS HTTP 200; no secrets in HTML; no browser or real delivery.');
} finally {
  for(const child of children)try{process.kill(-child.pid,'SIGTERM');}catch{}
  await new Promise(r=>setTimeout(r,300));await rm(dir,{recursive:true,force:true});
}
