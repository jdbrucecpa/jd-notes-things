# Push Release

Release a new version of JD Notes Things with proper versioning, tagging, auto-update support, and release notes.

## Arguments
- `$VERSION` - The new version number (e.g., "1.3.0")
- `$MESSAGE` - Brief description of changes for the commit message

## Instructions

You are releasing version $VERSION of JD Notes Things with message: "$MESSAGE". Follow these steps EXACTLY in order:

### Step 1: Validate Version Format
- Verify $VERSION matches semver format (X.Y.Z)
- Check that $VERSION is greater than the current version in package.json
- Check that tag `v$VERSION` does NOT already exist locally or on remote: `git tag -l v$VERSION` and `git ls-remote --tags origin | grep v$VERSION`
- If invalid or tag exists, stop and ask for a valid version number

### Step 2: Check Git Status & Review Changes
- Run `git status` to see current branch and uncommitted changes
- Run `git branch` to confirm current branch
- If on a feature branch, show the user what will be merged:
  ```bash
  git log main..HEAD --oneline
  git diff main --stat
  ```
- If there are uncommitted changes, list them — they will be included in this release

### Step 3: Run Lint
Run `npm run lint` and fix any errors or warnings before proceeding. Do NOT release with lint failures.

### Step 4: Update Version Number

Bump package.json AND package-lock.json in one step:

```bash
npm version $VERSION --no-git-tag-version
```

Do NOT edit `src/index.html` — the about-page version (`#appVersion`) is
populated at runtime from `app.getVersion()` (see settings.js), so
package.json is the single source of truth.

### Step 5: Generate Release Notes
Create `RELEASE_NOTES_v$VERSION.md` following the established format (see `RELEASE_NOTES_v1.3.0.md` for reference).

**Structure:**
```markdown
# v$VERSION Release Notes

## Highlights
[1-2 sentence summary of what this release does]

---

## [Section per major change area]
- **Bold lead-in**: Description of what changed and why.

[Repeat for each significant change]

---

## Files Changed
[N] files changed, ~[X] additions, ~[Y] deletions (net [+/-Z] lines)
```

**Guidelines:**
- Use `git log` and `git diff` between the previous version tag and HEAD to enumerate all changes
- Group changes by feature area, not by file
- Lead each bullet with a **bold phrase** summarizing the change, followed by a colon and details
- Include dependency additions/removals/updates in a table if any changed
- For patch releases (X.Y.Z where Z > 0), keep it concise — no need for the full dependency tables unless deps actually changed
- Include a "Files Changed" summary line at the bottom with stats from `git diff --shortstat`

### Step 6: Stage and Commit
```bash
git add -A
git commit -m "v$VERSION - $MESSAGE"
```
Use the provided message. Do NOT ask for confirmation — just commit with the message provided.

### Step 7: Pick the Release Path
Run `echo "$CLAUDE_CODE_REMOTE"`.

- **`true` → cloud session.** The git proxy only lets a cloud session push its own branch: pushes to `main` and to tags are refused with HTTP 403. Use **Path A** (GitHub API via the `mcp__github__*` tools — load them with ToolSearch if needed).
- **Anything else → local session.** Use **Path B** (plain git).

Both paths end in the same `.github/workflows/release.yml` run, which builds the Windows installer and publishes the GitHub Release.

### Step 8A: Cloud — Merge via PR, then Dispatch the Release Workflow
1. Push the release commit to the session's own branch: `git push -u origin <current-branch>`
2. Open a PR into `main` with `mcp__github__create_pull_request` (title `v$VERSION - $MESSAGE`, body = the release notes summary).
3. Merge it with `mcp__github__merge_pull_request` (`merge_method: "merge"`). If it isn't mergeable (conflicts, failing required checks), stop and report — do not dispatch.
4. Confirm `main` now carries the bump: `git fetch origin main && git show origin/main:package.json | grep '"version"'` must show `$VERSION`.
5. Dispatch the release with `mcp__github__actions_run_trigger`:
   - `method: "run_workflow"`, `workflow_id: "release.yml"`, `ref: "main"`, `inputs: { "version": "$VERSION" }` (no leading `v`)
6. The workflow refuses to run if it isn't on `main`, if `version` doesn't match `package.json`, or if tag `v$VERSION` already exists — those checks run before the ~20 minute build. On success, the Create Release step creates tag `v$VERSION` on the dispatched commit.

Do NOT `git push origin main` or `git push origin v$VERSION` from a cloud session — both 403.

### Step 8B: Local — Merge, Tag, and Push
If NOT already on main:
```bash
git checkout main
git pull origin main
git merge [feature-branch] --no-edit
```
If there are merge conflicts, stop and ask for help resolving them. Then:
```bash
git tag v$VERSION
git push origin main
git push origin v$VERSION
```
The tag push triggers the release workflow. (Path A also works locally via `gh workflow run release.yml -f version=$VERSION` after pushing main, if you'd rather not push tags.)

### Step 9: Verify
- **Cloud:** find the run with `mcp__github__actions_list` (`method: "list_workflow_runs"`, `workflow_id: "release.yml"`). The tag only appears once the build finishes and the release is created — check it with `git ls-remote --tags origin | grep v$VERSION` at that point, not right after the dispatch.
- **Local:** confirm the tag was pushed: `git ls-remote --tags origin | grep v$VERSION`
- Get the actual GitHub URL: `git remote get-url origin` (strip any credentials before showing it)
- Tell the user to check GitHub Actions for the release build status
- Provide the GitHub releases URL derived from the remote URL

### Important Notes
- `.github/workflows/release.yml` triggers on `v*` tag pushes (local path) and on `workflow_dispatch` with a `version` input (cloud path)
- It builds the Windows installer and creates a GitHub Release automatically
- Electron auto-update will pick up the new release from GitHub Releases
- Always ensure you're pushing to the correct remote (origin)

### Rollback (if needed)
- **Dispatch failed before Create Release:** nothing was tagged or published; fix the cause and dispatch again.
- **Local, before the tag is pushed:**
  ```bash
  git tag -d v$VERSION           # Delete local tag
  git reset --hard HEAD~1        # Undo last commit (if needed)
  ```
- **A tag or release is already on GitHub:** delete the release and tag in the GitHub UI (or locally with `git push origin :refs/tags/v$VERSION`). A cloud session can't delete remote tags — ask the user.
