---
name: awesome-design-md
description: Reference design systems extracted from 74 well-known brands (Apple, Stripe, Linear, Notion, Vercel, Nike, Tesla, Figma, Supabase...) as machine-readable DESIGN.md files - color tokens, typography scales, spacing, radii, shadows, motion, and component specs. Use when picking a visual direction, building or auditing a design system, choosing palettes/type pairings, or when the user asks to make something "look like" a specific brand.
---

# awesome-design-md

A vendored copy of [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md).
Each brand has one `references/<brand>/DESIGN.md` containing a YAML-ish front block
(`colors`, `typography`, `spacing`, `radii`, `shadows`, `motion`) followed by prose
describing layout principles and component patterns.

## How to use

1. Pick the brand whose feel matches the request (see index below).
2. Read **only that file** — `references/<brand>/DESIGN.md` is 20-60KB, so never read several at once.
   Grep first when you only need one section: `grep -A 30 '^colors:' references/apple/DESIGN.md`.
3. Translate the tokens into whatever this project already uses — its design tokens, theme file,
   or utility classes. Do not paste raw hex values inline, and do not introduce a second source of
   truth: **if the project already defines brand colors, that definition wins over anything here.**

These files are **inspiration references, not a license to copy a brand's identity.**
Take structure, scale, and rhythm; do not reproduce another company's logo, wordmark,
or trade dress in shipped UI.

## Index

- `airbnb`
- `airtable`
- `apple`
- `binance`
- `bmw`
- `bmw-m`
- `bugatti`
- `cal`
- `claude`
- `clay`
- `clickhouse`
- `cohere`
- `coinbase`
- `composio`
- `cursor`
- `dell-1996`
- `elevenlabs`
- `expo`
- `ferrari`
- `figma`
- `framer`
- `hashicorp`
- `hp`
- `ibm`
- `intercom`
- `kraken`
- `lamborghini`
- `linear.app`
- `lovable`
- `mastercard`
- `meta`
- `minimax`
- `mintlify`
- `miro`
- `mistral.ai`
- `mongodb`
- `nike`
- `nintendo-2001`
- `notion`
- `nvidia`
- `ollama`
- `opencode.ai`
- `pinterest`
- `playstation`
- `posthog`
- `raycast`
- `renault`
- `replicate`
- `resend`
- `revolut`
- `runwayml`
- `sanity`
- `sentry`
- `shopify`
- `slack`
- `spacex`
- `spotify`
- `starbucks`
- `stripe`
- `supabase`
- `superhuman`
- `tesla`
- `theverge`
- `together.ai`
- `uber`
- `vercel`
- `vodafone`
- `voltagent`
- `warp`
- `webflow`
- `wired`
- `wise`
- `x.ai`
- `zapier`
