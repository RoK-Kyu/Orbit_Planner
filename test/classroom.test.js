const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {Classroom,mergeClassroom,credentials,callbackResult}=require('../src/classroom');const {reminderFor,validateTask}=require('../src/core');
const course={id:'c1',name:'Operating Systems'};
const work={id:'w1',title:'Lab',description:'Instructions',dueDate:{year:2026,month:9,day:21},dueTime:{hours:15,minutes:59}};
const submission={userId:'student1',courseWorkId:'w1',state:'NEW'};
const state={tasks:[],settings:{notifications:true}};
test('UTC deadlines, classes without assignments, and no-deadline tasks',()=>{
 const result=mergeClassroom(state,[course,{id:'c2',name:'Algorithms'}],[{course,work,submission}]);assert.equal(result.next.tasks[0].due,'2026-09-21T15:59:00.000Z');assert.equal(result.next.classroomCourses.length,2);
 const undated=mergeClassroom(state,[course],[{course,work:{id:'w2',title:'Read'},submission}]).next.tasks[0];assert.equal(undated.due,null);assert.equal(reminderFor(undated),null);assert.equal(validateTask(undated).due,null);
});
test('repeated imports deduplicate while refreshing deadlines and keeping personal edits',()=>{
 const a=mergeClassroom(state,[course],[{course,work,submission}]);const old=a.next.tasks[0];old.priority='High';old.notes='My plan';old.reminderKey='previous';
 const b=mergeClassroom(a.next,[course],[{course,work:{...work,title:'New title',dueTime:{hours:16}},submission}]);assert.equal(b.added,0);assert.equal(b.next.tasks.length,1);assert.equal(b.next.tasks[0].priority,'High');assert.equal(b.next.tasks[0].notes,'My plan');assert.equal(b.next.tasks[0].title,'New title');assert.equal(b.next.tasks[0].reminderKey,null);assert.equal(old.title,'Lab');
});
test('submission completion, local override, ignored deletions, and separate accounts',()=>{
 const a=mergeClassroom(state,[course],[{course,work,submission:{...submission,state:'TURNED_IN'}}]);assert.equal(a.next.tasks[0].done,true);
 a.next.tasks[0].localDone=false;assert.equal(mergeClassroom(a.next,[course],[{course,work,submission:{...submission,state:'RETURNED'}}]).next.tasks[0].done,false);
 const hidden={...state,classroomIgnored:[a.next.tasks[0].sourceKey]};assert.equal(mergeClassroom(hidden,[course],[{course,work,submission}]).added,0);
 assert.equal(mergeClassroom(a.next,[course],[{course,work,submission:{...submission,userId:'student2'}}]).added,1);
 assert.equal(mergeClassroom(state,[course],[{course,work}]).added,0);
});
test('reject wrong credentials and forged or declined callbacks',()=>{
 assert.throws(()=>credentials({web:{client_id:'fake'}}));assert.throws(()=>callbackResult(new URL('http://127.0.0.1/oauth2callback?state=wrong&code=x'),'expected'));
 assert.throws(()=>callbackResult(new URL('http://127.0.0.1/oauth2callback?state=ok&error=access_denied'),'ok'));
 assert.equal(callbackResult(new URL('http://127.0.0.1/oauth2callback?state=ok&code=valid'),'ok'),'valid');assert.equal(callbackResult(new URL('http://127.0.0.1/favicon.ico'),'ok'),null);
});
function fixture(request,openExternal=()=>{}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-test-'));
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
 const client=new Classroom({directory,safeStorage,openExternal,request});
 return {client,cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
test('pagination and expired access token refresh',async()=>{
 const calls=[];const f=fixture(async(url,opts)=>{calls.push(String(url));if(String(url).includes('/token'))return {ok:true,json:async()=>({access_token:'new',expires_in:3600})};assert.equal(opts.headers.Authorization,'Bearer new');return {ok:true,status:200,json:async()=>calls.length===2?{courses:[{id:'a'}],nextPageToken:'page2'}:{courses:[{id:'b'}]}};});
 try{f.client.auth={client:{client_id:'a',client_secret:'b'},tokens:{refresh_token:'refresh'},expires:0};const result=await f.client.list('courses','courses',{studentId:'me'});assert.equal(result.length,2);assert.match(calls[2],/pageToken=page2/);}finally{f.cleanup();}
});
test('network and permission failures do not produce a partial import',async()=>{
 const f=fixture(async()=>({ok:false,status:403}));try{f.client.auth={tokens:{access_token:'a'},expires:Date.now()+3600000};await assert.rejects(()=>f.client.download(),/denied/);assert.equal(f.client.busy,false);}finally{f.cleanup();}
});
test('browser OAuth loopback flow uses PKCE, fixed Google endpoints and stores tokens',async()=>{
 let opened,exchange;
 const f=fixture(async(url,opts)=>{if(String(url).startsWith('https://classroom.googleapis.com/'))return {ok:true,status:200,json:async()=>({courses:[]})};assert.equal(url,'https://oauth2.googleapis.com/token');exchange=opts.body;return {ok:true,json:async()=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600})};},async value=>{
 opened=new URL(value);const callback=new URL(opened.searchParams.get('redirect_uri'));callback.searchParams.set('state',opened.searchParams.get('state'));callback.searchParams.set('code','test-code');
 // The local listener receives an imitation Google redirect; no Google account is used.
 await fetch(callback).catch(()=>{});
 });
 try{await f.client.connect({installed:{client_id:'test.apps.googleusercontent.com',client_secret:'test'}});assert.equal(opened.hostname,'accounts.google.com');assert.equal(opened.searchParams.get('code_challenge_method'),'S256');assert.equal(exchange.get('code'),'test-code');assert.ok(exchange.get('code_verifier'));assert.equal(f.client.status().connected,true);f.client.disconnect();assert.equal(f.client.status().connected,false);}finally{f.cleanup();}
});
test('Windows encrypted writes never call the Linux backend selector',()=>{
 const f=fixture(()=>{});try{f.client.platform='win32';f.client.safe.getSelectedStorageBackend=()=>{throw Error('Linux-only method');};f.client.write({tokens:{access_token:'test'}});assert.equal(f.client.status().connected,true);assert.ok(fs.existsSync(f.client.file));}finally{f.cleanup();}
});
test('Linux still refuses the insecure basic_text backend',()=>{
 const f=fixture(()=>{});try{f.client.platform='linux';f.client.safe.getSelectedStorageBackend=()=>'basic_text';assert.throws(()=>f.client.write({tokens:{}}),/Secure credential storage/);assert.equal(fs.existsSync(f.client.file),false);}finally{f.cleanup();}
});
test('token exchange failure remains visible after the browser callback',async()=>{
 const f=fixture(async()=>({ok:false,status:400,json:async()=>({error:'invalid_grant'})}),async value=>{const u=new URL(value),callback=new URL(u.searchParams.get('redirect_uri'));callback.searchParams.set('state',u.searchParams.get('state'));callback.searchParams.set('code','test-code');await fetch(callback).catch(()=>{});});
 try{await assert.rejects(()=>f.client.connect({installed:{client_id:'test.apps.googleusercontent.com',client_secret:'test'}}),/Finishing Google authorization/);assert.match(f.client.status().problem,/expired or was revoked/);assert.equal(f.client.busy,false);assert.equal(f.client.status().connected,false);}finally{f.cleanup();}
});
test('permission verification uses actual read access even with different reported scope names',async()=>{
 const calls=[];
 const f=fixture(async(url,opts)=>{
  calls.push(String(url));
  if(String(url).includes('/token'))return {ok:true,json:async()=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.student-submissions.me.readonly'})};
  assert.equal(opts.headers.Authorization,'Bearer test-access');
  return {ok:true,status:200,json:async()=>String(url).includes('courses?')?{courses:[{id:'course1'}]}:{}};
 },async value=>{const u=new URL(value),c=new URL(u.searchParams.get('redirect_uri'));c.searchParams.set('state',u.searchParams.get('state'));c.searchParams.set('code','test');await fetch(c).catch(()=>{});});
 try{await f.client.connect({installed:{client_id:'test.apps.googleusercontent.com',client_secret:'test'}});assert.equal(f.client.status().connected,true);assert.equal(calls.length,4);assert.match(calls[3],/studentSubmissions/);}finally{f.cleanup();}
});
test('missing coursework permission is rejected by Google API before storing sign-in',async()=>{
 const f=fixture(async url=>{
  if(String(url).includes('/token'))return {ok:true,json:async()=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600})};
  return String(url).includes('courses?')?{ok:true,status:200,json:async()=>({courses:[{id:'course1'}]})}:{ok:false,status:403};
 },async value=>{const u=new URL(value),c=new URL(u.searchParams.get('redirect_uri'));c.searchParams.set('state',u.searchParams.get('state'));c.searchParams.set('code','test');await fetch(c).catch(()=>{});});
 try{await assert.rejects(()=>f.client.connect({installed:{client_id:'test.apps.googleusercontent.com',client_secret:'test'}}),/Google denied coursework access/);assert.equal(f.client.status().connected,false);assert.equal(fs.existsSync(f.client.file),false);assert.match(f.client.problem,/Checking Classroom access/);}finally{f.cleanup();}
});
