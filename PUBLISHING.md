# Publishing `auto-permission-system`

This package ships on **npm**, and npm is what makes it appear in the
**[Pi package gallery](https://pi.dev/packages)** — there is no separate pi.dev
upload. Publish once to npm with the right manifest, and pi.dev discovers it.

The release pipeline is already automated (`semantic-release` on `main`). This
document covers the **one-time bootstrap** that has to happen before the
automation can take over, plus the discovery metadata.

- [1. One-time prerequisites](#1-one-time-prerequisites)
- [2. First publish (bootstrap)](#2-first-publish-bootstrap)
- [3. Enable npm Trusted Publishing](#3-enable-npm-trusted-publishing)
- [4. Turn the automated npm publish on](#4-turn-the-automated-npm-publish-on)
- [5. Pi package gallery (pi.dev) discoverability](#5-pi-package-gallery-pidev-discoverability)
- [6. Verify](#6-verify)
- [7. Troubleshooting](#7-troubleshooting)

## 1. One-time prerequisites

- An [npm](https://www.npmjs.com/signup) account with 2FA enabled.
- The name `auto-permission-system` must be free:
  ```bash
  npm view auto-permission-system version   # ERR! 404 => the name is available
  ```
- A clean checkout of `main` at the commit you intend to release.

> Trusted Publishing (OIDC) can only be configured **for a package that already
> exists on npm**. A brand-new name therefore needs one manual publish first —
> that is step 2.

## 2. First publish (bootstrap)

The first version must be published by hand. Do it from the exact commit the
release should point at, and let the version in `package.json` be the truth.

```bash
git clone https://github.com/Navin009/auto-permission-system
cd auto-permission-system
npm install
npm run typecheck
npm test

npm login --auth-type=web   # opens the browser; complete 2FA
npm whoami                  # sanity check: prints your username
npm publish --access public --otp=<6-digit-code>
```

If the account requires 2FA on writes (npm's default), the publish is rejected
with `E403 ... Two-factor authentication or granular access token with bypass 2fa
enabled is required`. Pass `--otp=<code>` from your authenticator, or publish with
a Granular Access Token that has **Bypass 2FA** enabled. See
[Troubleshooting](#7-troubleshooting).

`--access public` is required for an unscoped package to be publicly visible
(it is the default, but being explicit avoids an accidental 402). Provenance is
**not** available from a local machine — it is added automatically in step 4
once publishing moves to GitHub Actions over OIDC.

Then tag the version you just published and push both:

```bash
git tag -a v2.20.0 -m "chore(release): 2.20.0"
git push origin main --follow-tags
```

> Pushing also triggers the `CI` workflow, which in turn triggers `Release`. On
> that first run npm publishing is still off (`NPM_PUBLISH` unset), so
> `semantic-release` will compute the next version from commits — it will see
> `v2.20.0` as the last release and skip if there is nothing new. That is the
> intended behaviour; it creates the GitHub Release if a version is pending.

## 3. Enable npm Trusted Publishing

1. Open `https://www.npmjs.com/package/auto-permission-system/access`.
2. Under **Trusted Publisher**, choose **GitHub Actions** and set:
   - Organization or user: `Navin009`
   - Repository: `auto-permission-system`
   - Workflow filename: `release.yml`
   - Allowed action: `npm publish`
3. (Recommended) Under **Publishing access**, choose *Require two-factor
   authentication and disallow tokens*, then revoke any classic automation
   tokens you created earlier.

GitHub's `GITHUB_TOKEN` is injected automatically; the `id-token: write`
permission in `.github/workflows/release.yml` is what lets npm's OIDC exchange
succeed. No `NPM_TOKEN` secret is needed.

## 4. Turn the automated npm publish on

npm publishing is **opt-in** so that a failing registry step can never prevent
the GitHub Release from being created
(`@semantic-release/github` runs before `@semantic-release/npm`).

In the repository: **Settings → Secrets and variables → Actions → Variables →
New repository variable**

- Name: `NPM_PUBLISH`
- Value: `true`

`release.yml` passes it through as `NPM_PUBLISH`, and `.releaserc.cjs` gates the
npm plugin on `process.env.NPM_PUBLISH === 'true'`. The next push to `main` will
then publish to npm with provenance. Unset it (or set it to anything other than
`true`) to pause npm publishing without touching the release flow.

## 5. Pi package gallery (pi.dev) discoverability

pi.dev indexes npm packages that opt in with the **`pi-package` keyword** in
`package.json`; there is no form to fill in. This package already has it:

```jsonc
{
  "keywords": ["pi-package", "pi", "pi-coding-agent", "pi-extension", "security", "sandbox", "permission-system", "tool-guard"],
  "pi": {
    "extensions": ["./extensions/sandbox.ts", "./extensions/guard.ts", "./extensions/permission-mode.ts"],
    "skills": ["./skills"],
    "image": "https://raw.githubusercontent.com/Navin009/auto-permission-system/main/banner.png"
  }
}
```

What each part does for discovery:

| Field | Why it matters |
| ----- | -------------- |
| `keywords: ["pi-package", …]` | **Required.** Makes the npm package eligible for `https://pi.dev/packages`. |
| `pi.extensions` / `pi.skills` | Explicit resource manifest — what `pi install` wires up. |
| `pi.image` (optional) | Preview image on the gallery card. Use a stable raw URL. |
| `pi.video` (optional) | Short demo clip on the gallery card. |
| `description` | Shown on npm search and the gallery — keyword-rich, one sentence. |

After the first `npm publish`, the package shows up in the gallery (indexing is
usually quick, but may take a little while). Confirm with:

```bash
pi install npm:auto-permission-system
# or try it without installing:
pi -e npm:auto-permission-system
```

**Also worth doing** (GitHub-side search surface — not a file in this repo):

- Repository **About** → description + **Topics** (`pi`, `pi-package`,
  `ai-agent`, `sandbox`, `security`, `permission-system`, `bubblewrap`,
  `sandbox-exec`, `tool-guard`).
- Keep the README's first paragraph keyword-dense (it is indexed by npm, GitHub
  and search engines).

## 6. Verify

```bash
npm view auto-permission-system version dist.tarball
npm view auto-permission-system keywords
```

- npm page: `https://www.npmjs.com/package/auto-permission-system`
- Gallery: `https://pi.dev/packages` (search "auto-permission-system")
- GitHub Releases: `https://github.com/Navin009/auto-permission-system/releases`

## 7. Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| `E402 Payment Required` | Scoped/private publish; add `--access public`. |
| `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages` | npm requires 2FA on writes. Either run `npm publish --access public --otp=<TOTP>` (have the authenticator open — the code expires in ~30s), or publish with a [Granular Access Token](https://docs.npmjs.com/about-access-tokens) that has **Bypass 2FA** enabled. This is the expected first-publish obstacle for accounts with 2FA. |
| `E403 Forbidden` on first publish | Two-factor auth required; use `npm publish --otp=<code>`. |
| Trusted Publisher settings page 404s | The package does not exist yet — do step 2 first. |
| Release run fails at npm, no GitHub Release | Should not happen: the GitHub plugin runs first. Confirm `.releaserc.cjs` order and that `NPM_PUBLISH` is only set once Trusted Publishing works. |
| `Package not found` when installing with pi | The npm package is not published (or not public) yet. |
| Package not in the pi.dev gallery | `pi-package` keyword missing from `package.json`, or npm publish has not succeeded. |
