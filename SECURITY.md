# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/HatriGt/agent-sandbox/security/advisories/new)
(Security → Advisories → Report a vulnerability). That opens a private thread visible only to the
maintainers, and gives us a place to coordinate a fix and a CVE if one is warranted.

Please include, as far as you can:

- what an attacker gains (read a secret? spawn a VM? reach the host?),
- the exact request / input / repo content that triggers it,
- which surface it applies to — the stdio entry, the HTTP entry, the web console, or the in-box
  guard hooks,
- whether it needs the bearer token, or works unauthenticated.

Expect an initial response within a few days. This is a personal project, not a funded product with
an on-call rotation — please set your expectations accordingly, and disclose responsibly.

## Supported versions

The project is pre-1.0 and moves fast. Only the `main` branch receives security fixes; there are no
backports to older commits or tags.

## Threat model — read this first

[`docs/security.md`](docs/security.md) is the real document. The short version:

- **The microVM is the boundary that matters.** Every run gets its own KVM guest kernel. Anything the
  agent does inside — including deliberate destruction — ends at that boundary. Host compromise via
  the guest is the highest-severity class of bug here.
- **The realistic attack is exfiltration, not escape.** A box legitimately holds a GitHub token and
  your configured MCP secrets, because the agent needs them. So a prompt injection carried in a
  README, an issue, a web page or a tool result is the threat we actually defend against — with a
  deterministic `PreToolUse` denylist, a read-only `ask` lane, and allow-listed tools.
- **One bearer token is root-equivalent.** It can spawn VMs. It is checked with a timing-safe compare
  and fails closed when unset (the HTTP entry refuses to boot without it).

## Known gaps

These are documented, not hidden — see [Known gaps](docs/security.md#known-gaps-honest). Reports that
simply restate one of them are unlikely to be treated as new vulnerabilities, though a concrete
exploit that makes one materially worse is very welcome:

- the dashboard token lives in `localStorage` (interim, until real user authentication);
- one shared token, with no per-user identity, revocation or audit log;
- the in-box guard is a regex denylist — a determined injection can encode around it;
- no rate limiting on the token check;
- the agent runs as root inside its own VM.

## Out of scope

- Anything requiring the operator's bearer token to already be known.
- Attacks that require host root on the VPS you deployed to.
- Findings against a deployment that disabled the guard hooks or ran with `EGRESS_ALLOW_ALL` against
  an untrusted repo — that is a documented configuration tradeoff, not a defect.
- Missing hardening headers on a self-hosted deployment behind your own reverse proxy.
- Automated scanner output with no demonstrated impact.
