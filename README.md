# Orbit Planner

A Windows desktop app for assignments and projects. Minimal dark UI, mint accents, local data, subjects, priorities, quick capture, and reminders.

## Install on your Windows laptop

This download contains the complete source project, not a prebuilt EXE.

1. Install Node.js LTS from https://nodejs.org/ if you do not have it.
2. Extract the ZIP to a folder on your laptop.
3. Open `Install-and-Run.cmd`. Internet is needed once to download development tools and build the installer.
4. When the `dist` folder opens, run **Orbit Planner Setup 1.1.2.exe** and finish installation.
5. Open Orbit Planner from your desktop. After its first launch, it starts quietly at future Windows sign-ins.

The installer is unsigned. Do not disable Windows security settings; if your system or school policy blocks installation, keep the message and ask for help.

Alternatively, open a terminal in this folder:

```sh
npm ci
npm start
```

`npm start` runs a development copy. Install the packaged version for Windows startup and proper notification identity:

```sh
npm run dist
```

## Everyday use

- Type into the quick-entry bar and press Enter. Add a deadline, subject, and priority, then save.
- New tasks default to tomorrow at 11:59 PM. Change this to the real deadline.
- Subjects are created as you type them and reused through suggestions.
- Use Ctrl+N in Orbit, or Ctrl+Shift+Space from another app, to open task entry. If the global shortcut is already taken, use the tray's Add task action.
- Click a task title to edit; click its square to complete or reopen; click × to delete after confirmation.
- Search and filter by subject. Sort by deadline or priority.
- Closing the window keeps Orbit running in the tray. Double-click its tray icon to reopen. Right-click → Quit Orbit to stop it.
- Settings lets you control startup and reminders, test notifications, and export/restore backups.

## Reminder behavior

Orbit checks every 30 seconds and on wake. Reminders start 72 hours before the deadline, with follow-ups at 48 and 24 hours, at the deadline, and once per local calendar day when overdue. Priorities affect sorting and labels, not reminder frequency in this version.

If a task is created inside that window, or the laptop was asleep/off, only the current relevant reminder is sent. Missed reminders do not arrive as a burst. Multiple tasks needing attention together are grouped into one notification. Completed tasks do not notify. Editing a deadline resets its reminder identity. Notifications cannot appear while the laptop is asleep or off; they resume when Orbit runs again. Windows Do Not Disturb and notification permissions affect display. The app records reminders when submitted to Windows, not when read.

## Offline storage and backups

Manual tasks need no account or internet. Optional Classroom import contacts Google only; there is no telemetry. Tasks are saved in `%APPDATA%\orbit-planner\tasks.json` (Electron's user data directory) using a temporary file and rename. A corrupt file is left untouched and startup stops with an explanation. Export a backup regularly. Restore validates the backup and asks before replacing tasks; a dated safety copy is saved next to tasks.json. Data is local JSON, not encrypted.

## Connect Google Classroom (version 1.1)

If upgrading: export a backup in the old Orbit first, then right-click its tray icon and Quit Orbit. Extract this ZIP to a new folder, run Install-and-Run.cmd, and install Orbit Planner Setup 1.1.2.exe. The app identity and local data directory are unchanged, so existing tasks are retained. Do not uninstall and delete your app data.

1. Open Orbit → Settings → Google Classroom → Connect Google Classroom.
2. Select the Desktop app OAuth credentials JSON you downloaded from Google Cloud. You do not need to rename or paste its contents.
3. In your default browser, choose your school Classroom account and approve both read permissions.
4. Return to Orbit. It imports your active classes and assigned coursework automatically. Classes appear as subject suggestions and filters, including classes without assignments.
5. Use Import / refresh now whenever needed. Automatic refresh runs on app startup and every 15 minutes while connected.

The Google Cloud project must have Classroom API enabled, the two scopes below configured, a Desktop app client, and your school email added under Audience → Test users when using External/Testing:

- https://www.googleapis.com/auth/classroom.courses.readonly
- https://www.googleapis.com/auth/classroom.coursework.me.readonly

Import behavior:
- Imports published coursework with a submission record belonging to you from active classes where you are a student. Archived classes and teaching-only classes are excluded.
- Converts Google's UTC deadlines to your laptop's local display time. Undated work stays undated and does not trigger reminders.
- Repeated imports update by student, course, and assignment ID without duplicates. Titles, subjects, descriptions, and deadlines follow Classroom. Priority, task type, and personal notes remain yours.
- Turned-in and returned work starts as completed. Completing or reopening an imported task in Orbit creates a local override that persists across imports. Orbit never submits, edits, or deletes anything in Google Classroom.
- Deleting an imported task in Orbit keeps an ignore record so it does not reappear. Missing/removed Classroom work is retained locally; Orbit does not automatically delete local tasks.
- On any download failure, no partial batch is committed; your existing tasks remain available. The error is shown in Classroom settings.
- An initial import can include old overdue work from active classes; update its completion status in Orbit if needed. Notifications are grouped to avoid a burst.

Sign-in and disconnect:
- Uses the system browser, a temporary localhost callback, state validation, and PKCE. You enter your password only on Google's page.
- Credentials and tokens are encrypted through Electron safeStorage (Windows DPAPI) and kept in classroom-auth.enc beside the task data. They are never sent to the UI or included in task backups. Your originally downloaded credentials JSON remains wherever you saved it.
- Disconnect removes the saved sign-in from this laptop and stops imports. Imported tasks remain. It does not revoke Google's authorization; manage that separately in your Google Account's third-party connections if desired.
- Google External/Testing refresh tokens expire after seven days for these scopes. Click Reconnect and select your JSON again if sign-in expires. You may also need to reconnect after school policy changes or revocation.
- Cancel sign-in closes the temporary callback listener. A pending browser sign-in times out after three minutes.

Troubleshooting:
- Access denied: check you signed in with the test-user school email, selected both read permissions, and enabled Classroom API in the same project. Your school may require administrator approval.
- No classes: check the selected Google account. Only active student classes are imported.
- Wrong JSON: create/download an OAuth client of type Desktop app, not Web application or a service account.
- Offline: continue using saved tasks; refresh again when internet returns.

References:
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2#expiration
- https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork
- https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork.studentSubmissions/list
- https://www.electronjs.org/docs/latest/api/safe-storage

## Developer checks

`npm test` checks deadline boundaries, reminder deduplication, missed reminders, completed tasks, rescheduling, overdue handling, and validation. Windows startup, tray behavior, installer execution, and native notifications must be verified on a Windows laptop; this project was prepared in Linux. JavaScript syntax and all 17 core and Classroom tests passed. A visual/interface test could not run because the browser download timed out; the interface has not been visually verified. DOM interaction checks passed for Classroom connection/import, subject lists, undated tasks, imported-field protection, and manual task entry.

Source: `src/main.js` handles local storage, desktop lifecycle, and notifications; `src/core.js` contains validation/reminder logic; `src/preload.js` exposes a limited IPC bridge; `src/renderer.js`, `src/index.html`, and `src/style.css` implement the interface. Renderer uses context isolation, sandboxing, no Node integration, a restrictive content security policy, and text-only task rendering.

Classroom tests use mock Google responses and a real local callback listener. They cover UTC conversion, pagination, token refresh, duplicate prevention, completion overrides, ignored deletions, permission errors, credential validation, state checks, and PKCE flow. Live Google sign-in and Windows credential encryption still need testing on your laptop; no Google credentials or account were available during development.

## Version 1.1.1 sign-in repair

The Linux-only credential-backend check now runs only on Linux; Windows continues to use its encrypted credential store. Connection errors stay visible inside Settings and identify whether browser sign-in, token exchange, or secure storage failed. This addresses a platform-specific risk and the hidden error message; the exact failure on your laptop cannot be confirmed without that error. Your existing tasks and Google Cloud credentials do not need replacement.

## Version 1.1.2 permission verification

Replaces the exact scope-name rejection with read-only checks against the Classroom API before saving a new sign-in. The requested permissions remain the same. Google must permit class-list access, and, if an active student class exists, coursework and submission-status access. With no active classes, coursework access is checked when a later import has a resource to read. Every import continues to enforce API errors, and no partial batch is saved. This handles a possible mismatch between requested and reported scope identifiers without assuming the user denied permission. The reported identifiers from your live account were not available for inspection.
