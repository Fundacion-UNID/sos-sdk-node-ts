---
name: preserve-repository-work-boundary
description: Preserve repository-scoped branch and checkout discipline for every edit, test, merge or release in this repository. Use before starting work, creating a branch or worktree, or handling prior unmerged changes.
---

# Preserve the Repository Work Boundary

- Work only inside this repository's existing checkout. Do not create a
  worktree, clone, copy, temporary checkout or task directory outside it,
  including under a workspace-level `.codex-worktrees`, `/tmp` or
  `/private/tmp` path.
- An external worktree is allowed only after the user explicitly authorizes it
  for two identified, intentionally concurrent branches. State both branch
  names, their owners/paths and why simultaneous checkouts are necessary before
  creating it. Authorization is task-specific and does not carry forward.
- Never use another checkout to route around earlier unmerged work, postpone
  its integration or plan to test unrelated branches together later. Finish
  the earlier branch through its own tests, merge and cleanup first. If that
  would affect work owned by somebody else, stop and ask.
- If the checkout is clean and its current branch is already contained in the
  intended remote base, switch this same checkout to the updated base before
  creating the task branch.
- Keep generated test and visual evidence only in the repository's designated
  ignored artifact directories.
- At closure, push the explicit merge to `main`, delete the task branch and
  remove every task-specific auxiliary checkout that was expressly authorized.
  Do not delete pre-existing branches or directories of unknown ownership;
  report them separately.
