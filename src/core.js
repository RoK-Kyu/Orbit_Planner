const DAY = 86400000;
function validateTask(t) {
  if (!t || typeof t.title !== 'string' || !t.title.trim() || t.title.length > 200) throw Error('Enter a task title (up to 200 characters).');
  if (!['Low', 'Medium', 'High'].includes(t.priority)) throw Error('Choose a priority.');
  if (!['Assignment', 'Project'].includes(t.kind)) throw Error('Choose a task type.');
  if (t.due !== null && !Number.isFinite(Date.parse(t.due))) throw Error('Choose a valid deadline.');
  if (typeof t.subject !== 'string' || t.subject.length > 80) throw Error('Subject must be 80 characters or fewer.');
  if (typeof t.notes !== 'string' || t.notes.length > 5000) throw Error('Notes must be 5,000 characters or fewer.');
  return {title:t.title.trim(), subject:t.subject.trim() || 'General', priority:t.priority, kind:t.kind, due:t.due === null ? null : new Date(t.due).toISOString(), notes:t.notes, done:!!t.done};
}
// Only emit the most relevant reminder after startup/resume, not a burst of missed ones.
function reminderFor(t, now = Date.now()) {
  if (t.done || !Number.isFinite(Date.parse(t.due))) return null;
  const remaining = Date.parse(t.due) - now;
  if (remaining > 3 * DAY) return null;
  let stage;
  if (remaining <= 0) {
    const d = new Date(now);
    stage = `overdue-${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  } else stage = `before-${Math.ceil(remaining / DAY)}`;
  const key = `${t.due}:${stage}`;
  if (t.reminderKey === key) return null;
  return {key, text:remaining <= 0 ? 'Overdue — take a moment to update this task.' : `Due ${new Date(t.due).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`};
}
module.exports = {validateTask, reminderFor};
