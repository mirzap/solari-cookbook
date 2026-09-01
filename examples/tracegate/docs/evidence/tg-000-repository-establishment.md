# TG-000 — Public cookbook fork and project placement evidence

- **Recorded (UTC):** 2026-09-01T07:52:42Z
- **Operator:** Agent A (integration/evaluation owner)
- **Scope:** TG-000 only; no application code, workspace manifests, dependencies, tests, or TG-001 work were created.
- **Tools:** `gh version 2.98.0 (2026-08-20)`; `git version 2.50.1 (Apple Git-155)`

## Result

| Field | Verified value |
|---|---|
| Repository | `mirzap/solari-cookbook` |
| URL | `https://github.com/mirzap/solari-cookbook` |
| Visibility | `PUBLIC` |
| GitHub fork flag | `true` |
| Parent | `solari-sdk/solari-cookbook` |
| Parent URL | `https://github.com/solari-sdk/solari-cookbook` |
| Default branch | `main` |
| Submission branch | `tracegate-poc-submission` |
| Base commit before TG-000 files | `d304843f5ea0edb5c27829bb2ca30868645bef7a` |
| `origin` | `git@github.com:mirzap/solari-cookbook.git` (fetch/push) |
| `upstream` | `git@github.com:solari-sdk/solari-cookbook.git` (fetch/push) |

GitHub returned this redacted metadata after fork creation:

```json
{"defaultBranchRef":{"name":"main"},"isFork":true,"nameWithOwner":"mirzap/solari-cookbook","parent":{"name":"solari-cookbook","owner":{"login":"solari-sdk"}},"sshUrl":"git@github.com:mirzap/solari-cookbook.git","url":"https://github.com/mirzap/solari-cookbook","visibility":"PUBLIC"}
```

## Commands and observed results

Commands are shown exactly except that authentication token material is omitted/redacted. Local staging paths contain no credentials.

### 1. Preflight

```bash
gh auth status
gh repo view solari-sdk/solari-cookbook --json nameWithOwner,url,visibility,isFork,parent,defaultBranchRef
gh repo view mirzap/solari-cookbook --json nameWithOwner,url,visibility,isFork,parent,defaultBranchRef
git rev-parse --is-inside-work-tree
```

Observed:

```text
Logged in to github.com account mirzap (keyring); active account true; Git protocol ssh; token omitted.
Upstream: solari-sdk/solari-cookbook, PUBLIC, isFork=false, default branch main.
Candidate fork: repository did not exist.
fatal: not a git repository (or any of the parent directories): .git
```

### 2. Fork creation

The first attempted invocation was:

```bash
gh repo fork solari-sdk/solari-cookbook --clone=false --remote=false
```

It made no change and returned:

```text
the `--remote` flag is unsupported when a repository argument is provided
```

The supported command was then run:

```bash
gh repo fork solari-sdk/solari-cookbook --clone=false
```

Result:

```text
https://github.com/mirzap/solari-cookbook
```

### 3. Staged checkout, placement, remotes, and branch

```bash
git clone git@github.com:mirzap/solari-cookbook.git /tmp/tracegate-tg000-20260901095128/cookbook
find /tmp/tracegate-tg000-20260901095128/cookbook -name AGENTS.md -print
mkdir -p /tmp/tracegate-tg000-20260901095128/cookbook/examples/tracegate/docs/{plans,reviews,evidence}
cp docs/plans/tracegate-poc-build-2026-09-01.md /tmp/tracegate-tg000-20260901095128/cookbook/examples/tracegate/docs/plans/
cp docs/reviews/tracegate-poc-plan-critique-2026-09-01.md /tmp/tracegate-tg000-20260901095128/cookbook/examples/tracegate/docs/reviews/
git -C /tmp/tracegate-tg000-20260901095128/cookbook remote add upstream git@github.com:solari-sdk/solari-cookbook.git
git -C /tmp/tracegate-tg000-20260901095128/cookbook fetch upstream main
git -C /tmp/tracegate-tg000-20260901095128/cookbook switch -c tracegate-poc-submission
```

Observed:

```text
Clone completed.
No AGENTS.md was present.
examples/tracegate did not previously exist.
upstream/main fetched.
Switched to a new branch 'tracegate-poc-submission'.
```

The original `docs/` directory was retained in a temporary backup before the staged checkout was materialized at `/Users/mirzap/Developer/bosnadev/tracegate`. The first local copy stopped when the managed filesystem denied `.git` creation; an approved retry completed the checkout. No planning document was lost or modified.

### 4. Preservation hashes

Before relocation and in the final workspace:

```text
0ce495bb6c4165dbcc5148b6cee9401ed2926217f66b7288156f9e016414c700  tracegate-poc-build-2026-09-01.md
586e57d53f9a7f468297548ef5ba46b4e03ef9ed39a55c41b8e66d038fec3565  tracegate-poc-plan-critique-2026-09-01.md
```

Final required paths:

```text
examples/tracegate/docs/plans/tracegate-poc-build-2026-09-01.md
examples/tracegate/docs/reviews/tracegate-poc-plan-critique-2026-09-01.md
examples/tracegate/docs/evidence/tg-000-repository-establishment.md
```

The original `prompt-exports/` directory contained no files, so there was no additional planning artifact to relocate.

## Redaction review

- No GitHub token value is recorded.
- No API key, authorization header, CDP endpoint, replay URL, challenge token, or provider capability is present.
- Git repository URLs, public repository metadata, commit IDs, file hashes, branch names, and non-secret local paths are intentionally retained as reproducibility evidence.
