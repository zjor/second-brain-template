---
name: sync
description: Sync with the remote — pull, merge local changes via a temp branch, push. Resolves conflicts inline.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git checkout:*), Bash(git branch:*), Bash(git pull:*), Bash(git push:*), Bash(git merge:*), Bash(date:*), Read, Edit
---

Pull from the remote, merge local work via a temporary branch, push to the default branch (`main`).

## Steps

1. **Check working tree state**

   ```bash
   git status --porcelain
   ```

   - If empty → no local changes; jump to step 5.
   - If non-empty → mark `DIRTY=true` and continue.

2. **Create a sync branch and commit local work**

   ```bash
   BRANCH="sync-$(date +%Y%m%d-%H%M%S)"
   git checkout -b "$BRANCH"
   git add -A
   ```

   Look at `git diff --cached --stat` and write a one-line summary of what changed (e.g., *"sync: add 3 transcripts, update areas/user.md"*). Use that as the commit message:

   ```bash
   git commit -m "<your one-line summary>"
   git checkout main
   ```

3. **Pull the latest from remote**

   ```bash
   git pull origin main
   ```

4. **Merge the sync branch into main**

   ```bash
   git merge --no-ff "$BRANCH"
   ```

   - If conflicts → read the conflicted files, resolve them by understanding both sides (don't blindly pick `--ours` or `--theirs`), then:

     ```bash
     git add <resolved-files>
     git commit --no-edit
     ```

5. **Push**

   ```bash
   git push origin main
   ```

6. **Cleanup**

   - If `DIRTY=true`:
     ```bash
     git branch -d "$BRANCH"
     ```

7. **Report**

   Tell the user:
   - Whether there were local changes
   - The commit message used (if any)
   - Whether conflicts were resolved
   - That the push succeeded

## Safety

- Never run `git push --force` here.
- Never delete `main`.
- If anything fails mid-flow, stop and report — don't auto-recover with destructive operations.
