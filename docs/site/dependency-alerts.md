# Site dependency alerts

Status of the Dependabot alerts on `site/package-lock.json` (T-04, 2026-10-17). The 25 alerts open
on that date are listed below. Re-check the remaining ones when their upstream ships a fix.

## How a package was classified

- **Runtime** means the code ships in the built site. That means either the Worker
  (`.svelte-kit/cloudflare/_worker.js` and `.svelte-kit/output/server`) or the browser chunks
  (`.svelte-kit/cloudflare/_app`). The check is a grep of the `npm run build` output for a string
  unique to the package (`DOMPurify` for dompurify, devalue's `Cannot stringify` / `uneval`).
- **Dev** means the package only reaches the tree through a devDependency used for tests, build
  tooling or Lighthouse CI, and none of its code is in the build output.
- The import chains come from `npm ls <pkg> --all`.

Only two alert packages are in the build output:

- **dompurify** is a direct dependency, and it appears only in a browser chunk.
- **devalue** comes through `@sveltejs/kit` and `svelte`, both devDependencies, so Dependabot calls
  it "development". It is still bundled into the Worker's server chunks and the client.

## Fixed

These were fixed without `npm audit fix --force`, without a downgrade and without a prerelease.
Each fix is either a lockfile update within the existing semver ranges, or an npm `overrides` entry
within the same minor version.

| Alerts | Package | Class | Chain | From | To | How |
| --- | --- | --- | --- | --- | --- | --- |
| 103, 92 | dompurify | runtime (browser) | direct | 3.4.14 | 3.4.17 | lockfile |
| 99, 98, 96, 94 | devalue | runtime (worker + browser) | @sveltejs/kit, svelte | 5.9.0 | 5.9.4 | lockfile |
| 105, 72 | sharp | dev | miniflare (wrangler, vitest-pool-workers) | 0.35.2 | 0.35.5 | override `^0.35.5` (miniflare pins 0.35.2 exactly) |
| 85, 84, 83, 80, 79, 77 | undici | dev | miniflare, jsdom | 7.29.0 | 7.30.1 | override raised to `^7.29.1` (miniflare pins 7.28.0 exactly) |
| 102 | source-map-js | dev | vite > postcss, jsdom > css-tree | 1.2.1 | 1.2.2 | lockfile |
| 101 | proxy-addr | dev | @lhci/cli > express | 2.0.7 | 2.0.8 | lockfile |
| 100 | compression | dev | @lhci/cli | 1.8.1 | 1.8.2 | lockfile |
| 91, 86, 76 | ip-address | dev | @lhci/cli > proxy-agent > socks | 10.5.0 | 10.7.4 | lockfile |
| 89 | brace-expansion | dev | @lhci/cli > chrome-launcher > rimraf > glob > minimatch | 1.1.18 | 1.1.21 | lockfile |
| 73 | js-yaml | dev | @lhci/cli > @lhci/utils | 3.15.1 | 3.15.2 | lockfile |
| (none yet) | qs | dev | @lhci/cli > express, body-parser | 6.15.3 | 6.16.1 | lockfile (express 4.22.3, body-parser 1.20.8) |

## Remaining

| Alerts | Package | Class | Chain | Reason |
| --- | --- | --- | --- | --- |
| 104 | sprintf-js | dev | @lhci/cli > @lhci/utils > js-yaml 3 > argparse 1 | No fix: the advisory covers every release up to the latest, 1.1.3. It is only reached from argparse's CLI help formatting in Lighthouse CI, which gets no untrusted input. |
| 71, 66 | extract-zip | dev | @lhci/cli > lighthouse 12.6.1 > puppeteer-core > @puppeteer/browsers | No fix: every release is affected. `@lhci/cli` 0.15.1 is the newest release and pins lighthouse 12. npm's offered fix is a downgrade to `@lhci/cli` 0.13.0. It only extracts the Chrome download in the Lighthouse CI job. |
| (none yet) | basic-ftp | dev | @lhci/cli > proxy-agent > pac-proxy-agent > get-uri | Breaking-only: the fix is in basic-ftp 6.2.1 and later, but get-uri 6.0.5 depends on `^5.0.2`. It is only used if a PAC file or proxy URL uses `ftp:`, which Lighthouse CI here never does. |

Dismissing the remaining alerts in GitHub needs the owner's OK.

## Not taken

- **wrangler 4.151.1.** It is within `^4.112.0`, and plain `npm audit fix` picks it to move sharp
  off 0.35.2. It swaps the `miniflare` 5 alpha that wrangler 4.124 already uses for a
  `5.20261012.1-beta`, which is still a prerelease. The sharp override clears the same alerts
  without the bump.
- **@cloudflare/vitest-pool-workers 0.23.** It is outside `^0.18.6`, so it is a breaking 0.x bump.
  0.18.8 still brings in its own wrangler 4.114 and `miniflare` 4.x. The overrides above reach that
  copy too.

## Verification

Run these after any dependency change in `site/`:

1. `npm run build`
2. `npm run check` (svelte-check)
3. `npm run test:main`
4. `npm run test:build`
5. `npm run test:broadcaster`

Vitest runs against the built bundle, so build first.
