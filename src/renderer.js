const $ = id => document.getElementById(id);
let state = {tasks:[],settings:{}}, view='active', editing=null, packaged=false;
let toastTimer;
function toast(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,5000); }
async function attempt(fn) { try { return await fn(); } catch(e) { toast(e.message.replace(/^Error invoking remote method '[^']+': Error: /,'')); } }
function element(tag,cls,text) { const e=document.createElement(tag); if(cls)e.className=cls; if(text!==undefined)e.textContent=text; return e; }
function render() {
  const now=Date.now(), active=state.tasks.filter(t=>!t.done);
  $('today').textContent=new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'}).toUpperCase();
  $('active-count').textContent=active.length;
  $('soon-count').textContent=active.filter(t=>Date.parse(t.due)>=now&&Date.parse(t.due)<=now+3*86400000).length;
  $('late-count').textContent=active.filter(t=>Date.parse(t.due)<now).length;
  const subjects=[...new Set([...state.tasks.map(t=>t.subject),...(state.classroomCourses||[]).map(c=>c.name)])].sort();
  const previous=$('subject-filter').value;
  $('subject-filter').replaceChildren(new Option('All subjects',''),...subjects.map(s=>new Option(s,s)));
  if(subjects.includes(previous))$('subject-filter').value=previous;
  $('subjects').replaceChildren(...subjects.map(s=>new Option(s,s)));
  const search=$('search').value.toLowerCase();
  const tasks=state.tasks.filter(t=>(view==='done'?t.done:!t.done)&&(view!=='soon'||Date.parse(t.due)<=now+3*86400000)&&(!$('subject-filter').value||t.subject===$('subject-filter').value)&&`${t.title} ${t.subject} ${t.notes}`.toLowerCase().includes(search));
  const rank={High:0,Medium:1,Low:2};
  tasks.sort((a,b)=>($('sort').value==='priority'?rank[a.priority]-rank[b.priority]:0)||(a.due?Date.parse(a.due):Infinity)-(b.due?Date.parse(b.due):Infinity));
  $('list-title').textContent=({active:'My tasks',soon:'Due soon & overdue',done:'Completed'})[view]+` · ${tasks.length}`;
  $('tasks').replaceChildren();
  for(const t of tasks) {
    const row=element('article','task'+(t.done?' done':''));
    const check=element('button','check',t.done?'✓':'');check.setAttribute('aria-label',t.done?`Mark ${t.title} incomplete`:`Complete ${t.title}`);check.onclick=()=>attempt(async()=>{state=await window.orbit.toggle(t.id);render();});
    const content=element('div','task-content');const title=element('button','task-title',t.title);title.onclick=()=>openEditor(t);content.append(title);
    const meta=element('div','meta');meta.append(element('span','tag',t.subject),element('span','tag priority-'+t.priority,t.priority),element('span','',t.kind));
    const late=!t.done&&Date.parse(t.due)<now;meta.append(element('span','deadline'+(late?' late':''),(t.due?(late?'Overdue · ':'Due ')+new Date(t.due).toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'No deadline')));content.append(meta);
    if(t.sourceKey){const link=element('button','classroom-link','Open in Classroom ↗');link.onclick=()=>attempt(()=>window.orbit.classroomOpen(t.id));content.append(link);if(t.classroomDescription)content.append(element('p','task-note',t.classroomDescription));}
    if(t.notes)content.append(element('p','task-note',t.notes));
    const remove=element('button','icon','×');remove.setAttribute('aria-label',`Delete ${t.title}`);remove.onclick=()=>attempt(async()=>{state=await window.orbit.deleteTask(t.id);render();});row.append(check,content,remove);$('tasks').append(row);
  }
  if(!tasks.length) {
    const empty=element('div','empty');empty.append(element('div','orb','◎'),element('h3','',state.tasks.length?'Nothing here right now.':'Your next chapter starts here.'),element('p','',state.tasks.length?'Try another view or filter.':'Add an assignment or project. We’ll keep an eye on the deadline.'));$('tasks').append(empty);
  }
}
function localInput(date) { const d=new Date(date); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function openEditor(t=null, title='') {
  editing=t; $('task-form').reset();$('editor-title').textContent=t?'Edit task':'New task';
  $('title').value=t?.title||title;$('subject').value=t?.subject||$('subject-filter').value;
  $('kind').value=t?.kind||'Assignment';$('priority').value=t?.priority||'Medium';$('notes').value=t?.notes||'';
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(23,59,0,0);
  $('due').value=t?(t.due?localInput(t.due):''):localInput(tomorrow);for(const id of ['title','subject','due'])$(id).disabled=!!t?.sourceKey;if(!$('editor').open)$('editor').showModal();$('title').focus();
}
$('add').onclick=()=>openEditor();
$('quick').onsubmit=e=>{e.preventDefault();openEditor(null,$('quick-title').value.trim());};
for(const b of document.querySelectorAll('.close-editor'))b.onclick=()=>$('editor').close();
$('task-form').onsubmit=e=>{e.preventDefault();attempt(async()=>{
  const button=$('task-form').querySelector('[type=submit]');button.disabled=true;
  try {state=await window.orbit.saveTask({id:editing?.id,title:$('title').value,subject:$('subject').value,kind:$('kind').value,priority:$('priority').value,due:$('due').value?new Date($('due').value).toISOString():null,notes:$('notes').value,done:editing?.done||false});$('editor').close();$('quick-title').value='';render();toast('Task saved. You’re all set.');}finally{button.disabled=false;}
});};
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(n=>n.classList.toggle('active',n===b));render();};
for(const id of ['search','subject-filter','sort'])$(id).addEventListener('input',render);
$('settings-button').onclick=()=>{$('startup').checked=state.settings.startup;$('notifications').checked=state.settings.notifications;$('startup').disabled=!packaged;$('startup-note').textContent=packaged?'Enabled after installation; you can change it here.':'Startup becomes available when you install the built Windows app.';$('settings-dialog').showModal();attempt(refreshClassroomStatus);};
$('close-settings').onclick=()=>$('settings-dialog').close();
for(const id of ['startup','notifications'])$(id).onchange=()=>attempt(async()=>{try{state=await window.orbit.settings({startup:$('startup').checked,notifications:$('notifications').checked});toast('Preferences saved.');}finally{$('startup').checked=state.settings.startup;$('notifications').checked=state.settings.notifications;}});
$('test-notification').onclick=()=>attempt(async()=>{await window.orbit.testNotification();toast('Test sent. Check your Windows notifications.');});
$('export').onclick=()=>attempt(async()=>{if(await window.orbit.export())toast('Backup exported.');});
$('restore').onclick=()=>attempt(async()=>{state=await window.orbit.restore();render();});
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='n'){e.preventDefault();if(!$('settings-dialog').open)openEditor();}});
window.orbit.onQuickAdd(()=>{$('settings-dialog').close();openEditor();});
attempt(async()=>{const loaded=await window.orbit.load();state=loaded;packaged=loaded.packaged;if(!loaded.shortcutAvailable)$('shortcut-note').textContent='The global shortcut is in use by another app. Use Ctrl + N inside Orbit or Add task from the tray.';render();});
setInterval(render,30000);

let classroomUIBusy=false;
async function refreshClassroomStatus(){
 const s=await window.orbit.classroomStatus();
 $('classroom-status').textContent=s.problem||((s.connected?'Connected. ':'Not connected. ')+(s.lastSync?'Last import: '+new Date(s.lastSync).toLocaleString():''));
 $('classroom-sync').disabled=!s.connected||classroomUIBusy||s.busy;
 $('classroom-connect').disabled=classroomUIBusy||s.busy;
 $('classroom-connect').textContent=s.connected?'Reconnect / change account':'Connect Google Classroom';
 $('classroom-disconnect').disabled=!s.connected||classroomUIBusy||s.busy;
 $('classroom-cancel').disabled=!classroomUIBusy;
 $('classroom-courses').replaceChildren(...s.courses.map(c=>element('li','',c.name)));
}
async function classroomAction(fn){
 classroomUIBusy=true;await refreshClassroomStatus();
 let failure;
 try{await fn();}catch(e){failure=e;throw e;}finally{classroomUIBusy=false;await refreshClassroomStatus();if(failure)$('classroom-status').textContent=failure.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
}
$('classroom-connect').onclick=()=>attempt(()=>classroomAction(async()=>{
 $('classroom-status').textContent='Choose your JSON file, then finish Google sign-in in your browser…';
 if(await window.orbit.classroomConnect()){
  $('classroom-status').textContent='Connected. Importing your classes and assignments…';
  const r=await window.orbit.classroomSync();state=await window.orbit.load();render();toast(`Imported ${r.added} new tasks; refreshed ${r.updated}.`);
 }
}));
$('classroom-sync').onclick=()=>attempt(()=>classroomAction(async()=>{$('classroom-status').textContent='Importing Classroom…';const r=await window.orbit.classroomSync();state=await window.orbit.load();render();toast(`Imported ${r.added} new tasks; refreshed ${r.updated}.`);}));
$('classroom-cancel').onclick=()=>attempt(()=>window.orbit.classroomCancel());
$('classroom-disconnect').onclick=()=>attempt(()=>classroomAction(async()=>{await window.orbit.classroomDisconnect();toast('Disconnected on this laptop. Imported tasks are kept.');}));
window.orbit.onClassroomUpdated(()=>attempt(async()=>{state=await window.orbit.load();render();await refreshClassroomStatus();}));
