# study-tracker

Browser-only viewer for personal doctoral self-study progress. Sibling app to
[`anki-client`](https://github.com/dipidoo/anki-client) — **shares the GitHub
OAuth App and the OCF code-exchange proxy** with it. One auth registration, one
proxy, two SPAs.

**Live (after setup):** https://dipidoo.github.io/study-tracker/

## Design

See [`Agent.PD/learning/tracker/SYNC-DESIGN.md`](https://github.com/dipidoo/Agent.PD/blob/main/learning/tracker/SYNC-DESIGN.md). Short version:

- **Auth:** GitHub OAuth Web Flow → reuses anki-client's OAuth App (`Ov23liNeYzb2SRSZLynD`) and the OCF proxy at `https://www.ocf.berkeley.edu/~dip/anki-oauth/`. No second app, no second secret.
- **Content:** parsed at runtime from [`dipidoo/Agent.PD`](https://github.com/dipidoo/Agent.PD) (private) — `learning/columbia-engscd-plan.md` + `learning/courses/columbia-cvn/*.md`.
- **State:** one ProjectV2 Item per study unit (e.g. `ELEN-E6717-W3`) in a private board named `study-tracker/progress` (uses a separate prefix from anki-client so the two apps' boards don't collide).

## One-time setup

1. **Widen the existing OAuth App callback URL** on GitHub → settings/developers → "anki-client" — set Authorization callback URL to `https://dipidoo.github.io/` (hostname only, no path). Save. Anki-client continues to work because its dynamically-computed `redirect_uri` still satisfies the prefix.
2. **Confirm OCF proxy ALLOWED_ORIGINS** contains `https://dipidoo.github.io` — it already does for anki-client, no change needed.
3. **Create ProjectV2 board** named exactly `study-tracker/progress` on your account with the schema in [SYNC-DESIGN.md §7](https://github.com/dipidoo/Agent.PD/blob/main/learning/tracker/SYNC-DESIGN.md).
4. **Enable Pages** for this repo on the `gh-pages` branch.

## Development

```sh
npm install
npm run dev
```

Vite serves the app at http://localhost:5173/study-tracker/.

PAT fallback: paste a PAT (`repo` + `project` scopes) into the sign-in panel for dev.

## Build & deploy

```sh
npm run build
```

Outputs `dist/`. Deploy to `gh-pages` branch (or copy into the existing Pages workflow).

## License

MIT
