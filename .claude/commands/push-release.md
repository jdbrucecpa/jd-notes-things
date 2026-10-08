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

### Step 7: Push to main — CI Does the Rest
Never run `git tag` or push tags. `.github/workflows/release.yml` runs on every push to `main`: when `package.json` holds a version with no `v$VERSION` tag yet, it builds the Windows installer, then creates the tag and the GitHub Release at the pushed commit.

- **On main:** `git push origin main`
- **On a feature branch:** if you can push to main, merge first:
  ```bash
  git checkout main
  git pull origin main
  git merge [feature-branch] --no-edit
  git push origin main
  ```
  If there are merge conflicts, stop and ask for help resolving them.
- **Pushing to main isn't possible** (e.g. a cloud session, whose git proxy refuses pushes to `main` and to tags): push the session's own branch, open a PR into `main` titled `v$VERSION - $MESSAGE` (body = the release notes summary), and merge it with the merge method. If it isn't mergeable (conflicts, failing required checks), stop and report.

### Step 8: Verify
- Confirm `main` carries the bump: `git fetch origin main && git show origin/main:package.json | grep '"version"'` must show `$VERSION`.
- Find the run: `gh run list --workflow release.yml --limit 3` (or `mcp__github__actions_list` with `method: "list_workflow_runs"`, `workflow_id: "release.yml"`). Its `check` job should say it is releasing, and `build` should start.
- The tag only appears once the build finishes and the release is created (~10 minutes) — check `git ls-remote --tags origin | grep v$VERSION` then, not right after the push.
- Provide the GitHub Actions and Releases URLs, derived from `git remote get-url origin` (strip any credentials before showing it).

### Important Notes
- `.github/workflows/release.yml` triggers only on pushes to `main`; pushes that don't change the version are no-ops (the tag already exists).
- Tags created by CI with `GITHUB_TOKEN` don't trigger other workflows, so all build/publish steps belong in `release.yml`.
- Electron auto-update picks up the new release from GitHub Releases. The release is created only after the build succeeds, so it never appears without installers.
- `RELEASE_NOTES_v$VERSION.md` becomes the start of the release body, which the app shows as release notes; GitHub's generated notes follow it.

### Rollback (if needed)
- **Build failed:** nothing was tagged or published. Fix the cause and push to `main` again (the next push retries, since the tag is still missing), or re-run the failed workflow run.
- **Before pushing:** `git reset --hard HEAD~1` undoes the release commit.
- **A release is already on GitHub:** delete the release and its tag in the GitHub UI (`gh release delete v$VERSION --cleanup-tag`). A cloud session can't delete remote tags — ask the user.
