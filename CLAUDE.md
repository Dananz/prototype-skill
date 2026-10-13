# Repository instructions

These instructions apply when developing this repository and opening or updating
its pull requests. `SKILL.md` describes the Prototype plugin's behavior for users.

## Pull requests: publish screenshots automatically

Use `.github/PULL_REQUEST_TEMPLATE.md` for every PR. When a change affects the
visible UI, capture and embed actual screenshots before reporting the PR as ready.
Do this as part of the requested PR work, without waiting for a separate request
to attach images.

1. Capture the affected screen and interaction states before changing the UI and
   again after verifying the change. Match the viewport, theme, and state for each
   pair. Include desktop and phone layouts when affected, and a recording or GIF
   when a screenshot cannot demonstrate the interaction.
2. Inspect each capture. Use descriptive alt text and put the real images in the
   Screenshots table; descriptions of what an image would show do not count.
   For a new screen or state, use `N/A: new screen/state` in Before and an actual
   image in After. For nonvisual changes, use `N/A: no visual changes`.
3. Publish the captures automatically. Use GitHub attachment URLs if an available
   upload tool returns them. Otherwise, copy the images into
   `docs/pr/<change-slug>/`, commit only those captures with the PR's owned changes,
   and push them to the PR head branch. This repository already uses `docs/pr/`
   for visual evidence. Do not leave the images only in a local or ignored folder.
4. For committed captures, obtain the pushed commit SHA with `git rev-parse HEAD`
   and the repository owner/name with `gh repo view --json nameWithOwner`.
   Embed each image using an absolute URL pinned to that commit:

   ```markdown
   ![Menu before, desktop](https://github.com/OWNER/REPO/blob/COMMIT_SHA/docs/pr/CHANGE_SLUG/menu-before.png?raw=true)
   ```

   Replace every uppercase placeholder. Keep filenames URL-safe. Local filesystem
   paths and relative links in a PR body are not published screenshots.
5. Write the completed PR body to a temporary file. Create the PR with
   `gh pr create --body-file <file>`, or update it with
   `gh pr edit <number> --body-file <file>`. Updating screenshots must preserve
   the rest of an existing PR's description.
6. Read back the published body with
   `gh pr view <number> --json body --jq .body`. Confirm that each affected state
   has image Markdown, the URLs serve the intended images (using authenticated
   access for private repositories), and the images render in GitHub when browser
   access is available. Refresh the evidence after further visible changes.

Never replace evidence with "screenshots taken locally", "happy to attach them",
or an offer to upload later. If capture or publication fails, state the exact
blocker and keep the PR draft until the images are published. Do not claim the
screenshots are attached or the PR is ready without verifying publication.
