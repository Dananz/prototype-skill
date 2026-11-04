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
3. Publish the captures automatically as GitHub attachments, with `gh --attach`
   (GitHub CLI 2.99 or newer, push access to the repository). Never commit captures
   to this repository: every install carries what is committed. Without push access,
   drag the images into the PR description in the browser.
4. Write the completed PR body to a temporary file, next to the captures, and
   reference each image by its path relative to that file:

   ```markdown
   ![Menu before, desktop](./menu-before.png)
   ```

   Keep filenames URL-safe. `--attach` rewrites each reference to the uploaded URL.
   A local path still in the published body is not a published screenshot.
5. Create the PR with
   `gh pr create --body-file <file> --attach ./menu-before.png --attach ./menu-after.png`,
   or update it with `gh pr edit <number> --body-file <file> --attach ...` (up to 50
   files per command). Updating screenshots must preserve the rest of an existing
   PR's description. A non-zero exit can mean some files failed while the PR was still
   created or updated with the rest, so treat it as a failed publication until step 6
   passes.
6. Read back the published body with
   `gh pr view <number> --json body --jq .body`. Confirm that each affected state
   has image Markdown, the URLs serve the intended images (using authenticated
   access for private repositories), and the images render in GitHub when browser
   access is available. Refresh the evidence after further visible changes.

Never replace evidence with "screenshots taken locally", "happy to attach them",
or an offer to upload later. If capture or publication fails, state the exact
blocker and keep the PR draft until the images are published. Do not claim the
screenshots are attached or the PR is ready without verifying publication.

## Shell UI: keyboard focus

The shell's chrome has one keyboard focus outline: the base rule in `app/shell/shell.css`
(`--proto-focus`, a 1.5px inset line in the navigation's sky). Every button, link and
focusable row in the shell gets it without a class. Don't add `focus-visible:outline-*` or
`focus-visible:ring-*` to new shell controls. To restyle focus everywhere, change
`--proto-focus` or that rule. A control that needs something else (a separator showing its
line, a text field's ring) styles it with `focus-visible:` utilities, which override the base
rule. Designs inside `[data-mount]` keep the browser's own focus style.
