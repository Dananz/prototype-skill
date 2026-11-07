# Connect and retire page comments

Read this after `proto up`, on comment wakeups, and before ending prototype feedback.
Keep the original project root, session ID, exact subscription task ID and owning thread
across turns and compaction. `proto` means `node "<absolute-skill-dir>/scripts/proto.mjs"`;
pass the original `--project` and `--session` on every call below.

## Pick the mechanism

| Where | Listener |
| --- | --- |
| T3 Code (`T3CODE_THREAD_ID` is set) with T3 Connect on | the T3 webhook below |
| T3 Code with T3 Connect off, Claude | background `proto inbox --wait` (Other hosts below) |
| T3 Code with T3 Connect off, Codex | none: tell the user automatic replies need T3 Connect |
| Anywhere else | background `proto inbox --wait` where the host wakes the conversation when it ends |

Only `schedule_task` tells whether T3 Connect is on: it returns a `webhookUrl` only then. An
existing registered webhook proves it was on. Use the webhook only in T3 Code with that URL.

A listener is one subscription for this session: a webhook task or one background wait. Preserve it through ordinary
replies (including final replies), comment batches, compaction and temporary server stops
or updates. A pick alone does not finish review. Use the durable inbox as the source of
truth; webhook payloads are wake signals. Read `proto inbox` at the start and end of active
turns. Never add a listener agent, helper thread, recurring polling schedule, or second
subscription. Viewer comments sent by the owner use this same listener.

The project has one app, and each conversation in it has its own listener. A comment wakes the
conversation that owns its prototype (the last to `add`, `work`, `ask`, `pick` or `fav` on it); when
that one isn't listening, the listening conversation seen last. `proto inbox` takes this
conversation's comments, and others' only when their owner isn't listening. Registering yours never
touches another conversation's task, and `--close`, `--finish` and the seven-day cleanup look only at
this conversation's prototypes and comments. A conversation from before the project app keeps its
task: the import moves its listener with it.

## T3 Code with T3 Connect, both Codex and Claude

Discover the host's scheduling tools before declaring them unavailable. Use its documented
discovery or MCP transport if the initial catalog is incomplete. Host actions below are
instructions for the owning agent using those existing tools, not APIs provided by `proto`.

1. Run `proto inbox --reconcile --json` and `list_scheduled_tasks`. The JSON never includes
   the webhook URL. Match the saved task ID, project/session and owning thread, including
   disabled tasks. If these disagree, stop setup and report the ownership conflict. Do not
   move another conversation's subscription or disable unrelated tasks.
2. Apply any `hostAction` for this exact task in its owning thread using the host's supported
   enable/disable tool. Verify the resulting state with `list_scheduled_tasks`, then record
   it with `proto inbox --host-disabled <id>` or `--host-enabled <id>`. These commands only
   record an observed host state. They do not change the host task. If the saved state is
   stale (for example the task was disabled outside Prototype), record the observed state
   first and reconcile again. Never acknowledge an action that failed. A missing host task
   or unavailable host tool is a blocker to report, not a reason to create a replacement.
3. For `lifecycle: closed`, leave the task disabled unless the user explicitly resumes
   prototype review. Then run `proto inbox --reopen`, enable the same saved task, verify it,
   and record `--host-enabled <id>`. Retained credentials and notification receipts reconnect
   delivery without a duplicate subscription or repeated accepted wakes. `proto up` alone
   preserves closed state. For `opted-out`, preserve the user's choice through startup and
   wakeups. Only an explicit user request to enable comments authorizes `--reopen --again`.
4. For `missing`, first reuse a matching existing task. Older `--unlisten` removed its
   local record: a disabled matching task may be a prior user opt-out. Check thread context;
   if its reason is unknown or it was opted out, require an explicit user request before
   enabling it. Enable and verify an authorized task before registration. Only when neither
   local identity nor a matching host task exists, create one with `schedule: {type: "webhook"}` and `bindToCurrentThread: true`.
   Its prompt is the `hostPrompt` from step 1's JSON, copied exactly. Never write your own:

   ```text
   Prototype comments arrived. Handle them with the prototype skill: `proto inbox --project <project> --session <session>`
   ```

   Naming the skill loads the same instructions for Claude and Codex. No body placeholders
   (`{{body.batchId}}`) and no extra instructions: retries can wake the thread with nothing
   new to claim, and the skill already says how to handle a batch. A reused task whose prompt
   differs from `hostPrompt` gets it replaced (update the same task, keep its ID).
5. Save `{ "url": "<returned webhookUrl>", "id": "<scheduledTaskId>",
   "threadId": "<owning thread ID>" }` to a private temporary JSON file outside the served
   project. Register with `proto inbox --listen "<config.json>"`, then delete that file.
   The registered copy stays private. Never expose webhook URLs or secrets in source,
   replies, PRs or the page. If no webhook URL is returned, T3 Connect is off: delete the
   task you just created with `delete_scheduled_task` (never one you reused) and switch to
   Other hosts below. Claude listens with a background `proto inbox --wait`; Codex reports
   that automatic replies need T3 Connect. Do not claim the webhook connected.
6. Run `proto inbox --status`. It checks registration without claiming comments. A delivery
   failure retries; status reports the error. A host enable action remains required until
   verified and recorded. Reuse the same subscription after comments and replies. Do not
   also run `--wait`; cancel an existing legacy background wait once before switching.

## When feedback ends

Use these signals, then reconcile and apply/verify the exact host action above before the
final reply. Completion is an agent decision based on the user's request and actual delivery,
not an inference from a selected variant, a stopped server, a merged PR, or an ordinary reply.

| Signal | Action |
| --- | --- |
| User explicitly finishes or abandons the entire prototype session | `proto inbox --close finished` or `--close abandoned` |
| Selected design actually delivered into the app, verified there, and feedback for that prototype finished | `proto inbox --finish <slug>` for each finished prototype |
| User explicitly disables page-comment wakeups | `proto inbox --unlisten` (retains an explicit opt-out and exact task identity) |
| User explicitly resumes review | `proto inbox --reopen`, reuse/enable the saved task; opt-out requires `--again` and explicit user authorization |

`--finish` leaves the listener active for other prototypes. Archived prototypes count as
finished; picking does not. Editing a delivered prototype requires finishing it again.
New or unfinished taken comments, open intake and building work block terminal or inactivity
cleanup. Handle them before closing; `--unlisten` remains available for an explicit opt-out.
New comments arriving after closure stay in the inbox for an active turn or explicit reopening.

`proto up` (before app sync/GC), `proto inbox` (including wakeups), `--status` and `--reconcile`
check for seven days without prototype/theme edits, inbox/intake activity, or an active
startup/inbox turn. If there is no pending work, reconciliation closes an inactive listener
and emits a disable action. Existing legacy configs migrate while retaining their task,
thread, private URL and receipts. Keep protects session files, not an idle subscription.

**Execution boundary:** local closure immediately stops local notifications. The host task
is disabled only after the owning agent executes and verifies the host action. There is no
host expiry field, background cleanup agent, or autonomous crash/archived-thread expiry.
With no further runtime/agent execution, immediate host cleanup cannot be guaranteed.
Report a pending host action plainly if the host tools or owning thread are unavailable.

`proto stop` only stops the server; it preserves review and task identity for restart.
After feedback closure and verified host disable, stop the server if it is no longer needed.
`proto rm` requires host disable confirmation before deleting its identity. GC retains
sessions with a listener record (including opt-out) or pending work; explicit `proto rm`
retires those files after the host task is disabled. Removing them also removes reuse history.

## Other hosts, and T3 Code without T3 Connect

Use `proto inbox --wait` only when the host explicitly supports background completion
wakeups into this same conversation. Claude Code does, in T3 Code too: run it with the Bash
tool's `run_in_background: true` and a timeout of 7200000 ms (the command's own default is
115 minutes, under it), and its exit re-invokes this conversation. A running Codex
`exec_command`/`write_stdin` session alone does not provide this. Keep one supported wait with `--timeout <minutes>` (default
115), preserving its host job ID across compaction. On completion or timeout, rearm it
before processing comments or ending an ordinary turn. Reuse a live wait.

On explicit feedback completion or opt-out, cancel that exact host wait instead of rearming.
Without event subscriptions or completion wakeups, report the specific host limitation.
Comments persist until the next active chat turn; tell the user to send a chat message to
have them read. Do not block the foreground or promise automatic reactions while idle.
