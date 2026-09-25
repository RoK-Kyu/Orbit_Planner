const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {randomBytes, createHash, randomUUID} = require('node:crypto');
const SCOPES = ['https://www.googleapis.com/auth/classroom.courses.readonly','https://www.googleapis.com/auth/classroom.coursework.me.readonly'];
function credentials(json) {
  const c = json?.installed;
  if (!c || typeof c.client_id !== 'string' || !c.client_id.endsWith('.apps.googleusercontent.com') || typeof c.client_secret !== 'string') throw Error('Choose the JSON downloaded for a Desktop app OAuth client.');
  return {client_id:c.client_id,client_secret:c.client_secret};
}
function callbackResult(url, expected) {
  if (url.pathname !== '/oauth2callback') return null;
  if (url.searchParams.get('state') !== expected) throw Error('Sign-in state did not match. Please connect again.');
  if (url.searchParams.has('error')) throw Error('Google sign-in was declined. Check your test-user email or school access policy.');
  const code=url.searchParams.get('code'); if (!code) throw Error('Google did not return a sign-in code.');
  return code;
}
function mergeClassroom(state, courses, records) {
  const next=structuredClone(state), ignored=new Set(next.classroomIgnored||[]);
  const existing=new Map(next.tasks.filter(t=>t.sourceKey).map(t=>[t.sourceKey,t]));
  let added=0,updated=0;
  for (const {course,work,submission} of records) {
    if (!submission?.userId) continue; // Only work actually assigned to the signed-in student.
    const key=`${submission.userId}:${course.id}:${work.id}`;
    if (ignored.has(key)) continue;
    const d=work.dueDate,t=work.dueTime;
    const due=d&&t ? new Date(Date.UTC(d.year,d.month-1,d.day,t.hours||0,t.minutes||0,t.seconds||0)).toISOString() : null;
    const remoteDone=['TURNED_IN','RETURNED'].includes(submission.state);
    let item=existing.get(key);
    if (!item) {
      item={id:randomUUID(),createdAt:new Date().toISOString(),priority:'Medium',kind:'Assignment',notes:'',reminderKey:null,sourceKey:key};
      next.tasks.push(item);existing.set(key,item);added++;
    } else updated++;
    if(item.due!==due)item.reminderKey=null;
    Object.assign(item,{title:(work.title||'Classroom task').slice(0,200),subject:(course.name||'Classroom').slice(0,80),due,classroomDescription:(work.description||'').slice(0,30000),classroomLink:work.alternateLink||'',classroomState:submission.state,done:typeof item.localDone==='boolean'?item.localDone:remoteDone});
  }
  next.classroomCourses=courses.map(c=>({id:c.id,name:(c.name||'Classroom').slice(0,80)}));
  next.classroomLastSync=new Date().toISOString();
  return {next,added,updated};
}
class Classroom {
  constructor({directory,safeStorage,openExternal,request=fetch,platform=process.platform}) {
    this.platform=platform;this.file=path.join(directory,'classroom-auth.enc');this.safe=safeStorage;this.openExternal=openExternal;this.request=request;this.auth=null;this.busy=false;this.cancel=null;this.problem='';
    if(fs.existsSync(this.file))try {this.auth=JSON.parse(this.safe.decryptString(fs.readFileSync(this.file)));}catch {this.problem='Saved Google sign-in could not be unlocked. Connect again.';}
  }
  status(){return {connected:!!this.auth,busy:this.busy,problem:this.problem};}
  write(auth){
    if(!this.safe.isEncryptionAvailable() || (this.platform==='linux' && this.safe.getSelectedStorageBackend?.()==='basic_text'))throw Error('Secure credential storage is unavailable. Google sign-in was not saved.');
    fs.writeFileSync(this.file+'.tmp',this.safe.encryptString(JSON.stringify(auth)),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);this.auth=auth;this.problem='';
  }
  async token(params){
    let r;try {r=await this.request('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(params),signal:AbortSignal.timeout(30000)});}catch {throw Error('Could not reach Google. Check your internet connection and try again.');}
    let data;try{data=await r.json();}catch{throw Error(`Google returned an unreadable authorization response (HTTP ${r.status}).`);}
    if(!r.ok)throw Error(data.error==='invalid_grant'?'Google sign-in expired or was revoked. Connect again.':'Google could not authorize Orbit. Check your Desktop app credentials and connect again.');
    if(!data.access_token)throw Error('Google did not return an access token.');
    return data;
  }
  async verifyAccess(accessToken){
    const read=async(route,label)=>{
      let r;try{r=await this.request('https://classroom.googleapis.com/v1/'+route,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(30000)});}catch{throw Error('Could not reach Classroom. Check your connection and reconnect.');}
      if(!r.ok){
        if(r.status===403)throw Error(`Google denied ${label} access. Check the Classroom API is enabled and your school allows both read permissions.`);
        if(r.status===401)throw Error('Google did not accept this sign-in. Connect again.');
        throw Error(`Could not verify ${label} access (HTTP ${r.status}). Try again later.`);
      }
      return r.json();
    };
    const result=await read('courses?studentId=me&courseStates=ACTIVE&pageSize=1','class list');
    const course=result.courses?.[0];
    if(course){
      const prefix=`courses/${encodeURIComponent(course.id)}/courseWork`;
      await read(prefix+'?pageSize=1','coursework');
      await read(prefix+'/-/studentSubmissions?userId=me&pageSize=1','your submission status');
    }
    // With no active student classes there is no coursework resource to probe.
    // Every subsequent import still checks Google's response before committing.
  }
  async connect(json){
    if(this.busy)throw Error('A Classroom operation is already running.');
    if(!this.safe.isEncryptionAvailable())throw Error('Secure credential storage is unavailable.');
    const client=credentials(json);this.busy=true;this.problem='';
    let stage='Browser sign-in';
    try {
      const verifier=randomBytes(48).toString('base64url'), state=randomBytes(32).toString('base64url');
      const {code,redirect}=await new Promise((resolve,reject)=>{
        let finished=false,timer;
        const finish=(err,result)=>{if(finished)return;finished=true;clearTimeout(timer);server.close();server.closeAllConnections?.();this.cancel=null;err?reject(err):resolve(result);};
        const server=http.createServer((req,res)=>{
          res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');
          try {
            const result=callbackResult(new URL(req.url,'http://127.0.0.1'),state);
            if(!result){res.writeHead(404);res.end('Not found');return;}
            res.end('Google sign-in received. Return to Orbit Planner to finish connecting.');
            finish(null,{code:result,redirect:`http://127.0.0.1:${server.address().port}/oauth2callback`});
          }catch(e){res.writeHead(400);res.end('Sign-in failed. Return to Orbit and try again.');finish(e);}
        });
        server.on('error',()=>finish(Error('Could not open the local Google sign-in callback. Try again.')));
        this.cancel=()=>finish(Error('Google sign-in cancelled.'));
        timer=setTimeout(()=>finish(Error('Google sign-in timed out. Click Connect again.')),180000);
        server.listen(0,'127.0.0.1',()=>{
          const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
          url.search=new URLSearchParams({client_id:client.client_id,redirect_uri:`http://127.0.0.1:${server.address().port}/oauth2callback`,response_type:'code',scope:SCOPES.join(' '),access_type:'offline',prompt:'consent select_account',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
          Promise.resolve(this.openExternal(url.toString())).catch(()=>finish(Error('Could not open your default browser.')));
        });
      });
      stage='Finishing Google authorization';
      const tokens=await this.token({...client,code,redirect_uri:redirect,code_verifier:verifier,grant_type:'authorization_code'});
      // Google's returned scope identifiers can differ from the requested names.
      // Verify permission using read-only API calls; Google remains the authority.
      stage='Checking Classroom access';
      await this.verifyAccess(tokens.access_token);
      if(!tokens.refresh_token)throw Error('No offline access was granted. Connect again.');
      stage='Saving Google sign-in securely';
      this.write({client,tokens,expires:Date.now()+tokens.expires_in*1000});
    } catch(e) {this.problem=`${stage}: ${e.message}`;throw Error(this.problem);} finally {this.busy=false;}
  }
  async access(force=false){
    if(!this.auth)throw Error('Connect Google Classroom first.');
    if(force||Date.now()>this.auth.expires-60000){const tokens=await this.token({...this.auth.client,refresh_token:this.auth.tokens.refresh_token,grant_type:'refresh_token'});this.write({...this.auth,tokens:{...this.auth.tokens,...tokens},expires:Date.now()+tokens.expires_in*1000});}
    return this.auth.tokens.access_token;
  }
  async list(route,key,params={}){
    const items=[];let pageToken='';
    do {
      const url=new URL('https://classroom.googleapis.com/v1/'+route);url.search=new URLSearchParams({...params,pageSize:'100',...(pageToken?{pageToken}:{})});
      let r;
      for(let attempt=0;attempt<2;attempt++){
        const token=await this.access(attempt===1);
        try{r=await this.request(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});}catch{throw Error('You appear to be offline. Your saved tasks are still available.');}
        if(r.status!==401)break;
      }
      if(!r.ok)throw Error(r.status===403?'Google denied Classroom access. Check that the API is enabled, both permissions were granted, and your school allows Orbit.':r.status===401?'Google sign-in expired. Connect again.':`Classroom is unavailable (HTTP ${r.status}). Your saved tasks are unchanged; try again later.`);
      const data=await r.json();items.push(...(data[key]||[]));pageToken=data.nextPageToken||'';
    }while(pageToken);
    return items;
  }
  async download(){
    if(this.busy)throw Error('A Classroom operation is already running.');this.busy=true;
    try {
      const courses=await this.list('courses','courses',{studentId:'me',courseStates:'ACTIVE'}),records=[];
      for(const course of courses){
        const prefix=`courses/${encodeURIComponent(course.id)}/courseWork`;
        const work=await this.list(prefix,'courseWork');
        const submissions=await this.list(prefix+'/-/studentSubmissions','studentSubmissions',{userId:'me'});
        const byWork=new Map(submissions.map(s=>[s.courseWorkId,s]));
        for(const w of work)records.push({course,work:w,submission:byWork.get(w.id)});
      }
      this.problem='';return {courses,records};
    }catch(e){this.problem=e.message;throw e;}finally{this.busy=false;}
  }
  disconnect(){if(this.busy)throw Error('Wait for the current Classroom operation to finish, or cancel sign-in.');fs.rmSync(this.file,{force:true});this.auth=null;this.problem='';}
}
module.exports={Classroom,mergeClassroom,credentials,callbackResult};
