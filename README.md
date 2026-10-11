# Shareglow GitHub Action

Scans pages with `POST /v1/scan`, fails the workflow when a page has Open Graph errors (a missing
`og:title`, `og:image`, ...), and keeps **one** preview comment on the pull request (edited in place on every re-run).

```yaml
permissions:
  pull-requests: write
steps:
  - uses: Brandon-35/shareglow-action@v1
    with:
      api-key: ${{ secrets.SHAREGLOW_API_KEY }}
      urls: |
        https://preview-${{ github.event.pull_request.number }}.example.com/
```

**Pin a release tag** (for example `@v1`, or a full commit SHA) rather than `main`, so a change on the default branch cannot alter your CI.

| Input          | Default                        | Meaning                                                                                     |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `api-key`      | required                       | `sk_live_...` key, from a repository secret. Never printed in the log.                      |
| `urls`         | required                       | One URL per line, at most 20 (every scan is a metered API call).                            |
| `fail-on`      | `error`                        | `error`, `warning` or `never`. A page that cannot be scanned always fails (unless `never`). |
| `comment`      | `true`                         | Set `false` to skip the PR comment (the step summary is still written).                     |
| `github-token` | `${{ github.token }}`          | Needs `pull-requests: write`.                                                               |
| `api-url`      | `https://app.getshareglow.com` | Shareglow API origin.                                                                       |

Output `result` is `pass` or `fail`. Outside a `pull_request` event no comment is posted.

The action has no dependencies: it runs `src/main.ts` on Node 22 (type stripping). The pages you list are fetched
by the Shareglow scanner, which blocks private IPs, caps redirects and size; the action only talks to the Shareglow
and GitHub APIs, with a timeout, a response size cap and no redirects.

Source of truth: the Shareglow monorepo (`packages/github-action`); this repo is a published mirror. MIT licensed.
