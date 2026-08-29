# Self-hosting Agent Sandbox

One VPS with KVM, Docker, and `msb` (microsandbox). Everything else is in this repo.

## 1. Single operator (five minutes)

```bash
git clone https://github.com/<you>/agent-sandbox && cd agent-sandbox
cp .env.example .env
openssl rand -hex 32          # → MCP_HTTP_TOKEN in .env
# set ASB_DOMAIN, VPS_SSH, ANTHROPIC_* in .env (see comments there); put the host SSH key in deploy/id_ed25519
docker compose up -d --build
```

Open `https://<ASB_DOMAIN>/dashboard`, paste `MCP_HTTP_TOKEN`. That token is you: everything on the
controller — machines, GitHub accounts, MCP servers — is yours. Point your IDE at
`https://<ASB_DOMAIN>/mcp` with the same bearer.

## 2. Several people (no third-party login needed)

Add to `.env` and restart:

```
AUTH_MODE=saas
SIGNUP=open                           # public "Create an account" form; omit for invite-only
ADMIN_GITHUB_LOGINS=<your-login>      # optional: who becomes admin when signing in with GitHub
```

**Open sign-up:** the landing page gets **Sign in** and **Get started**; `/signup` asks name, username,
email, password and lands straight on the dashboard. API keys for an IDE are made later from
**Account → Connect an IDE** (ready-to-paste configs + a live connection test). On a
controller with **no** `ADMIN_GITHUB_LOGINS`, the first account created becomes **admin** (bootstrap);
once admins are configured, nobody is promoted by being first — set `ADMIN_GITHUB_LOGINS` *before*
opening sign-up on a public instance. A new account lands on **Connect your IDE**:
an API key is minted, dropped into ready-to-paste configs for Claude Code / Cursor / VS Code /
Windsurf, and a *Test connection* button proves it works before they leave the page.

**Invite-only** (`SIGNUP` unset): sign in with `MCP_HTTP_TOKEN` (you are the **operator**), go to
**Account → Manage users → Add user**, and hand over the access token shown once. They paste it at the
door; from **Account** they can set a password, mint more keys, or revoke.

What each user gets, and *only* they can see or touch:

| Theirs alone | Where it lives |
|---|---|
| Machines they start (Hub, `Run again`, MCP `delegate`) | `boxes.owner_id`; fleet is filtered; foreign box names answer 404 |
| GitHub accounts they connect | encrypted row per user; used only for *their* clones, PR cards, repo lists |
| MCP servers they configure | encrypted row per user; injected only into *their* machines |
| API keys | hashed at rest, revocable |
| Quota | `USER_MAX_BOXES` (default 2) concurrent machines |

Admins (and the operator token) see every machine and manage users. Warm-pool machines belong to
nobody until claimed.

### Optional: "Continue with GitHub"

Create a GitHub OAuth App (callback `https://<ASB_DOMAIN>/auth/github/callback`) and set
`GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`. The sign-in page grows a GitHub button;
a GitHub sign-in with the same login as an admin-created user links to that account.

## 3. Data and keys — back these up

| Path (inside `./data`, mounted into the container) | Contents |
|---|---|
| `asb.sqlite` (+ `-wal`, `-shm`) | users, sessions, API-key hashes, box ownership, audit, encrypted integrations |
| `secrets.key` | the AES-256 key for the encrypted rows (or set `SECRETS_KEY` in `.env` and it is not written) |

Lose `secrets.key` and every stored GitHub token / MCP secret is unreadable; users re-add them.

## 4. What the operator token can do — treat it like root

It bypasses ownership. Keep it in `.env` and in your password manager, nowhere else; use personal
tokens for daily work. Rotate it by editing `.env` and restarting — user sessions and API keys are
unaffected.

## 5. Upgrading

```bash
git pull && docker compose up -d --build
```

Schema migrations run at start. Moving from single-operator to `saas`: your existing GitHub
accounts and MCP servers become the operator's; existing machines belong to the operator.
