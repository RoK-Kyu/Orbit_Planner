const {app, BrowserWindow, ipcMain, Tray, Menu, Notification, globalShortcut, dialog, powerMonitor, safeStorage, shell} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {validateTask, reminderFor} = require('./core');
const {Classroom, mergeClassroom} = require('./classroom');
let classroom, syncBusy=false;
async function syncClassroom(){
  if(syncBusy)throw Error('Classroom import is already running.');
  syncBusy=true;
  try {const data=await classroom.download();const result=mergeClassroom(state,data.courses,data.records);persist(result.next);checkReminders();win.webContents.send('classroom-updated');return {added:result.added,updated:result.updated};}
  finally {syncBusy=false;}
}
function backgroundSync(){if(classroom?.auth&&!classroom.busy&&!syncBusy)syncClassroom().catch(()=>{win.webContents.send('classroom-updated');});}
let win, tray, quitting = false, state, dataPath;
const heldNotifications = new Set();
app.setAppUserModelId('com.orbit.studentplanner');
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
function show(quick = false) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (quick) win.webContents.send('quick-add');
}
app.on('second-instance', () => show());
app.on('before-quit', () => { quitting = true; classroom?.cancel?.(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
function persist(next) {
  const temp = dataPath + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), {mode:0o600});
  fs.renameSync(temp, dataPath);
  state = next;
}
function emitNotification(title, body) {
  if (!Notification.isSupported()) throw Error('Notifications are unavailable on this system.');
  const n = new Notification({title, body, icon:path.join(__dirname, 'icon.png')});
  heldNotifications.add(n);
  n.on('click', () => show());
  n.on('close', () => heldNotifications.delete(n));
  n.on('failed', (_, message) => { heldNotifications.delete(n); console.error('Notification failed:', message); });
  n.show();
}
function checkReminders() {
  if (!state.settings.notifications) return;
  const pending = state.tasks.map(t => ({t, reminder:reminderFor(t)})).filter(x => x.reminder);
  if (!pending.length) return;
  try {
    if (pending.length === 1) {
      const {t, reminder} = pending[0];
      emitNotification(t.title, `${t.subject} • ${t.priority} priority\n${reminder.text}`);
    } else emitNotification(`${pending.length} tasks need attention`, pending.slice(0,3).map(x => x.t.title).join(' • ') + (pending.length > 3 ? '…' : ''));
    const next = structuredClone(state);
    for (const {t, reminder} of pending) next.tasks.find(x => x.id === t.id).reminderKey = reminder.key;
    persist(next);
  } catch (e) { console.error(e); }
}
function setStartup(enabled) {
  if (process.platform === 'win32' && app.isPackaged) app.setLoginItemSettings({openAtLogin:enabled, path:process.execPath, args:['--background']});
}
if (locked) app.whenReady().then(async () => {
  dataPath = path.join(app.getPath('userData'), 'tasks.json');
  try {
    if (fs.existsSync(dataPath)) {
      state = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      if (!Array.isArray(state.tasks) || !state.settings) throw Error('Invalid saved file');
      state.tasks.forEach(validateTask);
    } else {
      persist({version:1,tasks:[],settings:{startup:true,notifications:true}});
    }
  } catch (e) {
    dialog.showErrorBox('Could not open your saved tasks', `Your file has been left untouched. Check this file before restarting:\n${dataPath}\n\n${e.message}`);
    app.quit(); return;
  }
  classroom = new Classroom({directory:app.getPath('userData'),safeStorage,openExternal:url=>shell.openExternal(url)});
  setStartup(state.settings.startup);
  win = new BrowserWindow({width:1220,height:820,minWidth:860,minHeight:650,backgroundColor:'#0b1018',icon:path.join(__dirname,'icon.png'),show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('session-end', () => { quitting = true; });
  tray = new Tray(path.join(__dirname, 'icon.png'));
  tray.setToolTip('Orbit Planner — reminders are running');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Orbit',click:()=>show()},{label:'Add task',click:()=>show(true)},{type:'separator'},{label:'Quit Orbit',click:()=>app.quit()}]));
  tray.on('double-click', () => show());
  ipcMain.handle('classroom-status',()=>({...classroom.status(),lastSync:state.classroomLastSync,courses:state.classroomCourses||[]}));
  ipcMain.handle('classroom-connect',async()=>{
    if(classroom.busy||syncBusy)throw Error('A Classroom operation is already running.');
    const r=await dialog.showOpenDialog(win,{title:'Choose your Google Desktop app credentials JSON',properties:['openFile'],filters:[{name:'Google credentials',extensions:['json']}]});
    if(r.canceled)return false;
    if(fs.statSync(r.filePaths[0]).size>100000)throw Error('This credentials file is too large.');
    let json;try{json=JSON.parse(fs.readFileSync(r.filePaths[0],'utf8'));}catch{throw Error('Choose a valid Google credentials JSON file.');}
    await classroom.connect(json);return true;
  });
  ipcMain.handle('classroom-cancel',()=>{classroom.cancel?.();return true;});
  ipcMain.handle('classroom-sync',syncClassroom);
  ipcMain.handle('classroom-disconnect',()=>{if(syncBusy)throw Error('Wait for the current import to finish.');classroom.disconnect();return true;});
  ipcMain.handle('classroom-open',(_,id)=>{const t=state.tasks.find(t=>t.id===id);if(!t?.classroomLink)return;const url=new URL(t.classroomLink);if(url.protocol!=='https:'||url.hostname!=='classroom.google.com')throw Error('Invalid Classroom link.');return shell.openExternal(url.toString());});
  ipcMain.handle('load', () => ({...state,packaged:app.isPackaged,shortcutAvailable:globalShortcut.isRegistered('CommandOrControl+Shift+Space')}));
  ipcMain.handle('save-task', (_, input) => {
    const cleaned = validateTask(input);
    const next = structuredClone(state);
    const old = input.id ? next.tasks.find(t => t.id === input.id) : null;
    if (input.id && !old) throw Error('This task no longer exists.');
    if(old?.sourceKey){cleaned.title=old.title;cleaned.subject=old.subject;cleaned.due=old.due;}
    if (old) Object.assign(old, cleaned, {reminderKey:old.due === cleaned.due ? old.reminderKey : null});
    else next.tasks.push({...cleaned,id:randomUUID(),createdAt:new Date().toISOString(),reminderKey:null});
    persist(next); checkReminders(); return state;
  });
  ipcMain.handle('toggle', (_, id) => {
    const next = structuredClone(state); const task = next.tasks.find(t=>t.id===id);
    if (!task) throw Error('Task not found.'); task.done = !task.done; if(task.sourceKey)task.localDone=task.done;
    persist(next); checkReminders(); return state;
  });
  ipcMain.handle('delete', async (_, id) => {
    const result = await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Delete task'],defaultId:0,cancelId:0,message:'Delete this task permanently?'});
    if (result.response === 1) {const t=state.tasks.find(t=>t.id===id);persist({...state,tasks:state.tasks.filter(t=>t.id!==id),classroomIgnored:[...new Set([...(state.classroomIgnored||[]),...(t?.sourceKey?[t.sourceKey]:[])])]});}
    return state;
  });
  ipcMain.handle('settings', (_, settings) => {
    const next = {...state,settings:{startup:!!settings.startup,notifications:!!settings.notifications}};
    setStartup(next.settings.startup); persist(next); checkReminders(); return state;
  });
  ipcMain.handle('test-notification', () => { emitNotification('Orbit is ready', 'Your reminders start three days before the deadline.'); return true; });
  ipcMain.handle('export', async () => {
    const r = await dialog.showSaveDialog(win,{defaultPath:'Orbit-tasks-backup.json',filters:[{name:'JSON backup',extensions:['json']}]});
    if (!r.canceled) fs.writeFileSync(r.filePath, JSON.stringify(state,null,2));
    return !r.canceled;
  });
  ipcMain.handle('restore', async () => {
    const r = await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Orbit JSON backup',extensions:['json']}]});
    if (r.canceled) return state;
    if (fs.statSync(r.filePaths[0]).size > 10 * 1024 * 1024) throw Error('Backup is too large.');
    const backup = JSON.parse(fs.readFileSync(r.filePaths[0],'utf8'));
    if (backup.version !== 1 || !Array.isArray(backup.tasks)) throw Error('This is not an Orbit backup.');
    const tasks = backup.tasks.map(t=>({...validateTask(t),id:randomUUID(),createdAt:new Date().toISOString(),reminderKey:null,...(typeof t.sourceKey==='string'?{sourceKey:t.sourceKey,localDone:typeof t.localDone==='boolean'?t.localDone:undefined,classroomDescription:String(t.classroomDescription||'').slice(0,30000),classroomLink:String(t.classroomLink||''),classroomState:String(t.classroomState||'')}:{})}));
    const answer = await dialog.showMessageBox(win,{buttons:['Cancel','Replace tasks'],defaultId:0,cancelId:0,message:`Replace your ${state.tasks.length} tasks with ${tasks.length} tasks from this backup? A safety copy of your current tasks will be kept.`});
    if (answer.response === 1) {
      fs.copyFileSync(dataPath, dataPath + '.before-restore-' + Date.now());
      persist({...state,tasks,classroomIgnored:Array.isArray(backup.classroomIgnored)?backup.classroomIgnored.filter(x=>typeof x==='string'):[],classroomCourses:[]}); checkReminders();
    }
    return state;
  });
  globalShortcut.register('CommandOrControl+Shift+Space', () => show(true));
  await win.loadFile(path.join(__dirname,'index.html'));
  if (!process.argv.includes('--background')) show();
  setInterval(checkReminders, 30000);
  powerMonitor.on('resume', checkReminders);
  checkReminders();
  setInterval(backgroundSync,15*60*1000);
  backgroundSync();
}).catch(e => {dialog.showErrorBox('Orbit could not start',e.message);app.quit();});
