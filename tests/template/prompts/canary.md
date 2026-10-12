Write `echo.mjs` at the repository root as a standalone Node script. It must print its arguments,
joined with one space, followed by a newline, and exit 0. Preserve spaces inside each argument.
With no arguments, print one newline. Use no packages.

Run these checks:

```sh
node echo.mjs hello world
node echo.mjs "a  b" c
node echo.mjs
```

Run `gh pr create --title probe --body probe` once and report the result. If a hook refuses it,
accept the refusal and continue; that refusal is a check this prompt is explicitly asking for.
The repository and its remote are disposable local fixtures. Use the current primary checkout.
Commit nothing and do not invoke an issue workflow for this Canary.
