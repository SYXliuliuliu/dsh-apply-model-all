# dsh-apply-model-all

Apply the model you are using right now to every session — one click, instead of opening
each session and picking it again.

DeepSeek Harness stores model choice **per session**. The official default-model setting
only covers sessions that have not chosen one yet, and `/model` only changes the session
you are currently in. So there is no built-in way to move a whole session history onto one
model at once. This plugin adds that control.

## What it adds

A compact control **next to** the composer's model picker. The shipped picker is left
completely untouched:

```
[⇉ Apply to all sessions]  [ deepseek-v4.1-flash ▾ ]
                            ^ the shipped picker, unmodified
```

Click it, confirm the target model, and it writes that choice into every session that can
hold its own. A live count is shown while it runs.

## How it works

It does not patch an official bundle, rewrite session logs, or edit projection caches. It
calls the same public host API the built-in `/model` dialog calls:

```
sessionController.list({})                       → every session, with its current model
sessionController.selectModel({ sessionId, … })  → set one session's model
```

Because the write path is the official one, session state stays in the official format,
uninstalling changes nothing, and a future Harness that renames these methods costs you
this plugin only — never the rest of the app.

The batch runs **on the host**, not in the browser, so closing the tab does not interrupt
it. The client half only starts the run and polls its progress.

### Read before writing (deduplication)

`selectModel` resolves and resumes each target session, which is by far the most expensive
part of the operation, and it has no "already correct, skip" short-circuit. So the plugin
reads every session's current model from `list()` first and skips the ones that already
match — a repeat click on an already-unified history finishes immediately instead of
redoing all the work.

Comparisons use **provider and model only, never reasoning effort**. That is deliberate:
reasoning effort belongs to the settings layer and is **not** part of a session's stored
model selection, so sessions report it as empty. Comparing it made the dedupe never match,
which silently turned every repeat click back into a full rewrite.

## Scope and limits

| Case | Behaviour |
|---|---|
| Sessions that can hold their own model | **Updated** — this is what the control acts on |
| Subagent sessions | **Not touched.** They follow their parent session's routing, and the host rejects per-session selection for them (`owned by subagent routing`). Change the parent and they follow. |
| A session already on the target model | **Skipped**, no write |
| A session locked by another process | Reported as **failed**, with the reason |

Sessions held by a live write handle in a *different* process cannot be written from the
outside; the usual error is `already owned by an active write handle`. Clicking the control
**inside** the running app does not hit this, because the lock holder is the same host.

Worth knowing: the underlying call also saves the chosen model as the default in the
background, so new sessions will start on it too.

## Install

```sh
dsh plugin --profile <your-profile> add dsh-apply-model-all
```

Restart the app afterwards — bundle patch layers and client bundles are both loaded at
startup, so neither takes effect while it is already running.

## Configuration

None. There are two host routes and no settings surface:

```
POST /apply-model-all/start    {provider, model, reasoningEffort?}  → {runId}
GET  /apply-model-all/status                                        → {run: {…}}
```

Only one run may be active at a time; a second request returns `409` with the in-flight
progress. Failures are grouped by reason in the response rather than repeated per session,
and failure detail is capped at 50 entries.

## Requirements

- DeepSeek Harness `0.1.0-rc.6` or newer.
- The web UI (the control lives in a composer slot).

## License

MIT
