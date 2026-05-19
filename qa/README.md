# Auto QA Script

An automated QA tester powered by Claude AI + Playwright. It opens your app in a real browser, performs flows like a human tester would, takes screenshots, and writes a bug report.

---

## How it works (the simple version)

Three pieces work together:

```
+----------------------+      +-----------------------+      +-------------------+
|  run-qa.ps1          |      |  Claude CLI agent     |      |  Playwright MCP   |
|  (the orchestrator)  | -->  |  (the QA "brain")     | -->  |  (controls the    |
|                      |      |  reads qa-prompt.md   |      |   real browser)   |
|  1. starts dev server|      |  + qa-config.json     |      |                   |
|  2. waits for port   |      |  decides what to test |      |  click / type /   |
|  3. launches Claude  |      |  writes the report    |      |  screenshot / etc |
|  4. kills server     |      |                       |      |                   |
+----------------------+      +-----------------------+      +-------------------+
                                          |
                                          v
                              +-----------------------+
                              |  qa/reports/*.md      |
                              |  qa/screenshots/*.png |
                              +-----------------------+
```

**Step by step what happens when you run `./qa/run-qa.ps1`:**

1. **Orchestrator** (`run-qa.ps1`) starts your app with `npm run dev` in the background.
2. It waits until the dev server is listening on the configured port.
3. It launches Claude in **headless mode** (`claude -p ...`) and feeds it `qa-prompt.md` as instructions.
4. Claude reads `qa-config.json` to learn: the app URL, login credentials, flows to test, things to watch for, things to skip.
5. For each flow, Claude uses **Playwright MCP** to click buttons, type into fields, navigate pages, take screenshots — exactly like a human QA engineer.
6. Claude collects bugs (console errors, broken pages, slow responses, layout issues) and writes them to `qa/reports/report-YYYY-MM-DD.md`.
7. The orchestrator kills the dev server when Claude exits.

**Key idea:** the script itself doesn't know how to test your app. It just sets up the environment. The actual testing intelligence comes from Claude, guided by your `qa-config.json` (what to test) and `qa-prompt.md` (how to behave).

---

## Files in this folder

| File | What it is |
|---|---|
| `run-qa.ps1` | The runner script. Starts dev server, launches Claude, cleans up. |
| `qa-config.json` | **Project-specific.** What to test: URL, accounts, flows, skip rules. |
| `qa-prompt.md` | The instructions Claude follows. Usually doesn't need editing. |
| `reports/` | Markdown bug reports, one per run. |
| `screenshots/` | PNG screenshots referenced by the reports. |
| `README.md` | This file. |

---

## One-time setup (do this once per machine)

1. **Install Claude Code CLI** (if you don't have it):
   ```powershell
   npm install -g @anthropic-ai/claude-code
   claude --version
   ```

2. **Register Playwright MCP** with Claude (this gives Claude the ability to control a browser):
   ```powershell
   claude mcp add playwright -- npx -y @playwright/mcp@latest
   claude mcp list
   ```
   You should see `playwright` in the list. The first run will download a browser (~150 MB).

3. **Allow PowerShell scripts to run** (only needed once, in an admin PowerShell):
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```

---

## Run it on THIS project

```powershell
.\qa\run-qa.ps1
```

That's it. It will take 5–15 minutes. When it finishes, open the latest file in `qa/reports/`.

---

## Use it on ANOTHER project

The whole `qa/` folder is portable. To use it on a different project:

### Step 1 — Copy the folder

Copy `qa/` from this project into the **root** of the new project:

```
new-project/
├─ package.json
├─ src/
└─ qa/                <-- copy this whole folder here
   ├─ run-qa.ps1
   ├─ qa-config.json
   ├─ qa-prompt.md
   └─ README.md
```

You can delete `qa/reports/` and `qa/screenshots/` — those are from the old project's runs.

### Step 2 — Edit `qa-config.json`

Open `qa/qa-config.json` and change these to fit the new project:

| Field | What to put |
|---|---|
| `project` | Name of the new project. |
| `baseUrl` | The URL the dev server listens on (e.g. `http://localhost:3000` for Next.js, `http://localhost:5173` for default Vite, `http://localhost:8080` for this project). |
| `startCommand` | The command that starts the dev server. Usually `npm run dev`, sometimes `npm start` or `yarn dev`. |
| `testAccounts` | Real test credentials for the new project's login. You can have as many roles as you want. |
| `loginSelectors` | CSS/Playwright selectors for the login email field, password field, and submit button on the new app's login screen. |
| `flows` | The list of things to test. Each flow has a `name`, optional `account` key (must match a key under `testAccounts`), a list of `steps` in plain English, and a `severity` (`critical` / `high` / `medium` / `low`). |
| `skipAreas` | A list of things Claude must **not** do (delete data, submit real forms, send emails, etc.). |
| `watchFor` | A list of things to look out for during testing. The defaults usually work. |

**Tip:** start with 2–3 simple flows (just "login" + "click around the main pages"). Run it once, look at the report, then add more flows.

### Step 3 — That's it, run it

```powershell
.\qa\run-qa.ps1
```

The orchestrator reads `baseUrl` from the config, so it automatically uses the correct port for any project.

---

## A minimal `qa-config.json` for a brand-new project

If you're starting from scratch, this is the smallest useful config:

```json
{
  "project": "My App",
  "baseUrl": "http://localhost:3000",
  "startCommand": "npm run dev",
  "startupWaitSeconds": 30,

  "testAccounts": {
    "user": {
      "email": "test@example.com",
      "password": "test-password",
      "role": "user"
    }
  },

  "loginSelectors": {
    "emailInput": "input[type='email']",
    "passwordInput": "input[type='password']",
    "submitButton": "button[type='submit']"
  },

  "flows": [
    {
      "name": "Login - happy path",
      "account": "user",
      "steps": [
        "Navigate to baseUrl",
        "Fill the email and password fields with the user account",
        "Click the submit button",
        "Verify the user is no longer on the login screen",
        "Verify no console errors"
      ],
      "severity": "critical"
    },
    {
      "name": "Main navigation smoke test",
      "account": "user",
      "steps": [
        "Login as user",
        "Click every top-level menu item one by one",
        "For each page: wait 2 seconds, screenshot, capture console errors"
      ],
      "severity": "high"
    }
  ],

  "skipAreas": [
    "Do not delete any data",
    "Do not change passwords",
    "Do not send emails or notifications"
  ],

  "watchFor": [
    "Console errors",
    "Network 4xx/5xx responses",
    "Blank pages",
    "Layout breaks",
    "Slow responses over 3 seconds"
  ],

  "report": {
    "outputDir": "qa/reports",
    "screenshotDir": "qa/screenshots",
    "format": "markdown",
    "includeScreenshots": true
  }
}
```

---

## How to write good flows

Claude reads your `steps` as instructions, so plain English works. A few tips:

- **Be specific:** "Click the blue Save button at the bottom of the form" is better than "Save the form."
- **Say what success looks like:** end each flow with a verify step ("Verify the dashboard shows 5 cards", "Verify the URL contains /home").
- **Reference accounts by key:** if a flow needs a logged-in user, set `"account": "admin"` and the key must exist in `testAccounts`. If it doesn't, Claude will skip the flow.
- **Mark severity honestly:** `critical` = the app is unusable if this breaks; `high` = a key feature is broken; `medium` = data quality / minor breakage; `low` = polish, copy, accessibility.

---

## What's "safe" and what isn't

Claude follows the `skipAreas` rules strictly. By default the script will **not**:

- Delete any records
- Submit real applications, payments, or forms with real-world consequences
- Change passwords or emails on existing users
- Send notifications or emails
- Modify payroll, contracts, or other sensitive data

**However:** Claude **will** log in with the credentials you give it and hit your real backend. If you don't want it touching production, point `baseUrl` at a local dev server (which is the default) or a staging environment.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `claude: command not found` | Claude CLI not installed or not on PATH | Run `npm install -g @anthropic-ai/claude-code` and re-open the terminal |
| `playwright` not in `claude mcp list` | Playwright MCP not registered | `claude mcp add playwright -- npx -y @playwright/mcp@latest` |
| Script says "Dev server did not become ready" | App takes longer than `startupWaitSeconds` to start | Increase `startupWaitSeconds` in the config (try 60 for slower projects) |
| Many flows reported as "Skipped" | Flow references an account key that doesn't exist in `testAccounts` | Add the missing account, or rename the flow's `account` field |
| Report says login failed | Wrong credentials, or `loginSelectors` don't match the new app | Update `testAccounts` and verify `loginSelectors` by inspecting the login form |
| `taskkill: not recognized` at the end | `System32` not on PATH when invoked from git-bash | Already fixed in `run-qa.ps1` — re-pull if you have an older copy |
| Browser pops up but nothing happens | First-time Playwright install in progress (downloading browser) | Wait — the next run will be faster |

---

## What the script costs you

Each run uses Claude API tokens via the Claude CLI. Typical run on this project (12 flows): a few cents to a couple of dollars depending on report size. The agent is allowed to use only these tools (whitelisted in `run-qa.ps1`):

- `mcp__playwright` — browser control
- `Read`, `Write` — read the config, write the report
- `Glob`, `Grep` — search the codebase if it needs context
- `Bash` — minor shell utilities

No other tools (Edit, network fetches beyond Playwright, etc.) are available to the agent.
