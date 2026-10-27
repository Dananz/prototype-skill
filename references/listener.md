# Connect page comments

Read this immediately after `proto up`, before building or ending the first turn.
Keep the original project root, session ID, subscription task ID and owning thread across
turns and compaction. `proto` means `node "<absolute-skill-dir>/scripts/proto.mjs"`.

Keep one listener for the entire session, including while handling comments. Never add a
listener agent, helper conversation, recurring polling task, or second subscription.
Viewer comments from share links arrive through this same listener once the owner sends them
from the page (or `proto share take`); they need no second listener.
Read `proto inbox` at the start and end of active turns to handle pending comments.

## T3 Code, both Codex and Claude

Use `schedule_task` with a webhook to wake this conversation on every page send.
Discover the host's tools before declaring them unavailable. Use its documented discovery
or MCP transport if the initial tool catalog is incomplete.

1. Run `list_scheduled_tasks` first. Reuse the enabled webhook for this project/session
   and owning thread. Never create one per turn or batch.
2. If none exists, create one with `schedule: {type: "webhook"}` and
   `bindToCurrentThread: true`. T3 posts its prompt into the thread on every page send,
   so keep it to this one line, with the project and session filled in:

   ```text
   Prototype comments arrived. Handle them with the prototype skill: `proto inbox --project <project> --session <session>`
   ```

   Naming the skill loads it in a thread that doesn't have it yet; in the owning thread it
   is already loaded. Don't repeat this file's rules in the prompt, and leave out
   `{{body.batchId}}`: the inbox is the source of truth, and T3 appends an untrusted-data
   notice to every placeholder. Retries or several sends can wake the thread with nothing
   new to claim.
3. Save `{ "url": "<returned webhookUrl>", "id": "<scheduledTaskId>",
   "threadId": "<owning thread ID>" }` to a private temporary JSON file outside the served
   project. Run `proto inbox --listen "<config.json>"` with the original project/session
   flags, then delete the temporary file. The URL is a credential: never put it in source,
   a reply, a PR, or the page. The registered copy is private.
   If no `webhookUrl` is returned, disable that task and report that T3 Connect remote
   access must be enabled. Do not claim a listener was connected.
4. Run `proto inbox --status` to verify registration without taking comments. Keep the
   same subscription enabled after comments, final replies, compaction and server updates.
   `proto up` restores delivery after restart. Failed delivery retries automatically;
   `proto inbox --status` reports errors. Do not also run `--wait`. If switching from an
   existing background wait, cancel that harness job once first.
5. Stop only when the user asks: `proto inbox --unlisten`, then disable the same host task.
   Do not silently move another conversation's subscription here. To change its owner,
   explicitly remove and disable the old subscription before registering the replacement.

## Other hosts

A running Codex `exec_command` or `write_stdin` session does not by itself establish a
wakeup into an idle conversation. Use `proto inbox --wait` only when the host explicitly
supports background completion wakeups into this same conversation.

Start one wait through that mechanism with `--timeout <minutes>` (default 115). It exits
to deliver its batch. On every completion, including a timeout, immediately rearm one wait
before processing the batch or ending the turn. Reuse a live wait; preserve its job ID
across compaction. An unrelated task finishing is no reason to cancel it.

Do not block the foreground turn waiting for future comments. Without event subscriptions
or completion wakeups, state the specific host limitation. Comments persist until the
next chat turn; read `proto inbox` at the start and end of active turns and tell the user
to send a chat message to have them read. Do not promise automatic reactions while idle.
