# pi-secure-extension

Adds two protections to [Pi](https://pi.dev):

1. **Workspace boundary** — `read`/`write`/`edit` outside the current
   project's working directory are hard-blocked (no way to confirm past it).
2. **Confirmation dialog** — before every `bash` command and every
   `write`/`edit` inside the workspace, an OpenCode-style dialog appears
   with three options:
   - **Allow once** — runs this one time, asks again next time
   - **Allow for this session** — for `bash`, remembers that exact command
     text; for `write`/`edit`, grants blanket permission for the rest of
     the session (any file)
   - **Deny** — blocks the operation

## Install

```bash
pi install git:github.com/mcvladoc33/pi-secure-extention
```

Project-local install instead of global:

```bash
pi install -l git:github.com/mcvladoc33/pi-secure-extention
```

Then `/reload` (or restart `pi`) to pick it up.
