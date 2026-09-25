const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('orbit', {
  classroomStatus:()=>ipcRenderer.invoke('classroom-status'),
  classroomConnect:()=>ipcRenderer.invoke('classroom-connect'),
  classroomCancel:()=>ipcRenderer.invoke('classroom-cancel'),
  classroomSync:()=>ipcRenderer.invoke('classroom-sync'),
  classroomDisconnect:()=>ipcRenderer.invoke('classroom-disconnect'),
  classroomOpen:id=>ipcRenderer.invoke('classroom-open',id),
  onClassroomUpdated:fn=>ipcRenderer.on('classroom-updated',()=>fn()),
  load:()=>ipcRenderer.invoke('load'),
  saveTask:t=>ipcRenderer.invoke('save-task',t),
  toggle:id=>ipcRenderer.invoke('toggle',id),
  deleteTask:id=>ipcRenderer.invoke('delete',id),
  settings:s=>ipcRenderer.invoke('settings',s),
  testNotification:()=>ipcRenderer.invoke('test-notification'),
  export:()=>ipcRenderer.invoke('export'),
  restore:()=>ipcRenderer.invoke('restore'),
  onQuickAdd:fn=>ipcRenderer.on('quick-add',()=>fn())
});
