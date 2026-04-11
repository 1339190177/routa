---
title: Web
---

# Web

Web is a first-class Routa runtime surface, but it is not the default distribution path for
most end users.

## When To Use Web

- local contribution and development
- self-hosting
- browser-first access to the same workspace model used by Desktop

## Run Locally

```bash
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

If you want the web UI to point at a local backend:

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210" npm run dev
```

## Best Fit

Use Web when you want:

- the browser surface during local development
- self-hosted deployment instead of the packaged desktop app
- a contribution workflow against the Next.js runtime

## Why Web Is Different

Web is intentionally described as a runtime surface, not the default first-install path. If
your goal is to start using Routa quickly, choose [Desktop](/platforms/desktop) or
[CLI](/platforms/cli) first.

## Related Docs

- [Quick Start](/quick-start)
- [Architecture](/ARCHITECTURE)
- [Release Guide](/release-guide)
