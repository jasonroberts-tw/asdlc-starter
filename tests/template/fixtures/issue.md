Add a standalone Node script named `echo.mjs` at the repository root. Use no packages and follow
the existing issue-to-merge workflow; the requested route is `via-merge` and the remote is local.

## Acceptance Criteria

- `node echo.mjs hello world` prints `hello world` followed by one newline, and exits 0.
- `node echo.mjs "a  b" c` prints `a  b c` followed by one newline, and exits 0.
- `node echo.mjs` prints one newline, and exits 0.
- Arguments retain their internal spaces and are joined with one space.

The operator wants no automated test for this script. Each criterion is a manual-verify item, and
running its command before the merge verifies it.
