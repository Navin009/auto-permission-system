// Release configuration (CommonJS so it can read the environment).
//
// Why this is not `.releaserc.json`:
// npm publishing is gated behind `NPM_PUBLISH=true`. The package is not on the
// npm registry yet (Trusted Publishing still has to be configured once at
// https://www.npmjs.com/package/auto-permission-system/access). A failing npm
// publish would abort the run, and by default @semantic-release/npm runs before
// @semantic-release/github — meaning the GitHub Release would never be created.
// With the gate, the first release creates the Release page (and bumps the
// version); flip the repository variable NPM_PUBLISH=true to also publish.
const npmPublish = process.env.NPM_PUBLISH === 'true';

module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
        changelogTitle:
          '# Changelog\n\nAll notable changes to this project will be documented in this file.\nEntries below [1.0.0] are generated automatically by [semantic-release](https://semantic-release.gitbook.io/) from [Conventional Commits](https://www.conventionalcommits.org/) \u2014 do not edit by hand.',
      },
    ],
    // The GitHub Release is created before npm publish on purpose: publishing to
    // the registry must never be able to prevent the Release page from existing.
    [
      '@semantic-release/github',
      {
        assets: [],
      },
    ],
    [
      '@semantic-release/npm',
      {
        npmPublish,
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
  ],
};
