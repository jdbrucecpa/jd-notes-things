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

### Step 4: Update Version Numbers
**IMPORTANT:** Read each file first before editing (the Edit tool requires a prior Read).

Update the version number in BOTH locations:

1. **package.json** - Update the `"version": "X.Y.Z"` field
2. **src/index.html** - Update the about page version: `<p class="version" id="appVersion">vX.Y.Z</p>`

The version in index.html should have a "v" prefix.

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

### Step 7: Merge to Main (if on feature branch)
If NOT already on main:
```bash
git checkout main
git pull origin main
git merge [feature-branch] --no-edit
```
If there are merge conflicts, stop and ask for help resolving them.

### Step 8: Create and Push Tag
```bash
git tag v$VERSION
git push origin main
git push origin v$VERSION
```

### Step 9: Verify
- Confirm the tag was pushed: `git ls-remote --tags origin | grep v$VERSION`
- Get the actual GitHub URL: `git remote get-url origin`
- Tell the user to check GitHub Actions for the release build status
- Provide the GitHub releases URL derived from the remote URL

### Important Notes
- The GitHub Action `.github/workflows/release.yml` triggers on `v*` tags
- It builds the Windows installer and creates a GitHub Release automatically
- Electron auto-update will pick up the new release from GitHub Releases
- Always ensure you're pushing to the correct remote (origin)

### Rollback (if needed)
If something goes wrong:
```bash
git tag -d v$VERSION           # Delete local tag
git push origin :refs/tags/v$VERSION  # Delete remote tag
git reset --hard HEAD~1        # Undo last commit (if needed)
```
