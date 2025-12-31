# Push Release

Release a new version of JD Notes Things with proper versioning, tagging, and auto-update support.

## Arguments
- `$VERSION` - The new version number (e.g., "1.3.0")
- `$MESSAGE` - Brief description of changes for the commit message

## Instructions

You are releasing version $VERSION of JD Notes Things with message: "$MESSAGE". Follow these steps EXACTLY in order:

### Step 1: Validate Version Format
- Verify $VERSION matches semver format (X.Y.Z)
- Check that $VERSION is greater than the current version in package.json
- If invalid, stop and ask for a valid version number

### Step 2: Check Git Status
- Run `git status` to see current branch and uncommitted changes
- Run `git branch` to confirm current branch
- If there are uncommitted changes, they will be included in this release

### Step 3: Update Version Numbers
Update the version number in BOTH locations:

1. **package.json** - Update the `"version": "X.Y.Z"` field
2. **src/index.html** - Update the about page version: `<p class="version" id="appVersion">vX.Y.Z</p>`

Use the Edit tool to make these changes. The version in index.html should have a "v" prefix.

### Step 4: Stage and Commit
```bash
git add -A
git commit -m "v$VERSION - $MESSAGE"
```
Use the provided message. Do NOT ask for confirmation - just commit with the message provided.

### Step 5: Merge to Main (if on feature branch)
If NOT already on main:
```bash
git checkout main
git pull origin main
git merge [feature-branch] --no-edit
```
If there are merge conflicts, stop and ask for help resolving them.

### Step 6: Create and Push Tag
```bash
git tag v$VERSION
git push origin main
git push origin v$VERSION
```

### Step 7: Verify
- Confirm the tag was pushed: `git ls-remote --tags origin | grep v$VERSION`
- Tell the user to check GitHub Actions for the release build status
- Provide the GitHub releases URL: https://github.com/[owner]/[repo]/releases

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
