const {test}=require('node:test');const assert=require('node:assert/strict');const {reminderFor,validateTask}=require('../src/core');
const due='2026-09-20T12:00:00.000Z';const task={title:'Reviewer',subject:'OS',kind:'Assignment',priority:'High',due,notes:'',done:false};
test('reminder boundaries at 3, 2, and 1 day',()=>{
 const deadline=Date.parse(due), day=86400000;
 assert.equal(reminderFor(task,deadline-3*day-1),null);
 for(const n of [3,2,1]) assert.equal(reminderFor(task,deadline-n*day).key,`${due}:before-${n}`);
 assert.match(reminderFor(task,deadline).key,/overdue/);
});
test('deduplicates across restarts and advances after missed days',()=>{
 const now=Date.parse(due)-3*86400000;
 const saved={...task,reminderKey:reminderFor(task,now).key};
 assert.equal(reminderFor(saved,now+1000),null);
 assert.match(reminderFor(saved,now+2*86400000).key,/before-1$/);
});
test('completed tasks never notify; rescheduling changes reminder identity',()=>{
 assert.equal(reminderFor({...task,done:true},Date.parse(due)),null);
 const saved={...task,reminderKey:reminderFor(task,Date.parse(due)-86400000).key,due:'2026-09-21T12:00:00Z'};
 assert.ok(reminderFor(saved,Date.parse(due)-86400000));
});
test('overdue dedup is daily',()=>{
 const now=Date.parse(due)+86400000;const saved={...task,reminderKey:reminderFor(task,now).key};
 assert.equal(reminderFor(saved,now+1000),null);assert.ok(reminderFor(saved,now+86400000));
});
test('validation rejects malformed tasks and normalizes input',()=>{
 for(const patch of [{title:' '},{due:'invalid'},{priority:'Urgent'},{subject:123},{notes:null},{kind:'unknown'}])assert.throws(()=>validateTask({...task,...patch}));
 assert.equal(validateTask({...task,title:'  Read  ',subject:''}).title,'Read');assert.equal(validateTask({...task,subject:''}).subject,'General');
});
