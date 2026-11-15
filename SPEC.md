# VEXO — SPEC

Local tool to batch-post images (ComfyUI) to Pixiv, DeviantArt, Civitai, X and SubscribeStar (adult).

## Decisions (2026-11-10)

| # | Topic | Choice |
|---|---|---|
| 1 | Platforms | Pixiv, DeviantArt, Civitai, X |
| 2 | Login | Driven browser (Playwright, Edge channel) with a persistent session; official Civitai API if possible |
| 3 | Hosting | Local, `http://127.0.0.1:3210`, single user, no app login |
| 4 | Stack | Vite + React 19 + Tailwind 4 / Fastify 5 + `node:sqlite` + sharp / Playwright |
| 5 | Content | SFW + NSFW → `nsfw` flag per image |
| 6 | Metadata | 1 common set (title, tags, description) + optional per-platform override |
| 7 | ComfyUI | Reads PNG chunks `prompt` (ComfyUI) and `parameters` (A1111): model, LoRA, seed, steps, cfg, sampler, prompts |
| 8 | Grouping | Chosen when sending: 1 multi-image post (default, remembered) or 1 post per image |
| 9 | Pace | Queue with adjustable delay between posts + scheduling |
| 10 | Persistence | History (where/when/link), duplicate check (sha256), drafts, tag presets |

## Decisions — auto-tag (2026-11-13)

| # | Topic | Choice |
|---|---|---|
| 1 | Detection | ComfyUI prompt (whole words, `_` = space, `\(` escapes ignored) + LoRA file names (substring, punctuation ignored); A1111 `<lora:…>` too |
| 2 | Language | One global setting: English or Japanese |
| 3 | Character list | Starts empty; added from a Danbooru tag (autocomplete), JP name / Pixiv tag / series fetched from Danbooru wiki `other_names` + `related_tag` (copyright) |
| 4 | When | On import (setting) + *Auto-tag* button (Library, inspector, Characters page) |
| 5 | Tags added | Name, series (option), Pixiv-style `コハク(Dr.STONE)` in JP (option), extra tags per character |
| 6 | Auto-title | When the title is empty / the file name / a title previously generated: `Kohaku / Dr. Stone` |
| 7 | Language switch | Re-running auto-tag replaces every language variant of the detected characters' tags; other tags are kept |
| 8 | UI language | Everything in English |

## Decisions — Pixiv short titles, presets, DeviantArt (2026-11-14)

| # | Topic | Choice |
|---|---|---|
| 1 | Short auto-title | Per-platform override title when the generated title exceeds `titleMax` (Pixiv 32, DA 50): full → names only → `First +N` → truncated `…`. Only generated titles are replaced, never user-typed ones |
| 2 | Tag presets | Both: Presets page (CRUD, from selection, bulk add/remove) + inspector chips (click = add to all / remove when all have it) |
| 3 | DeviantArt R-18 | Posted with `is_mature: true` + warning in the Publish dialog |
| 4 | DeviantArt folder | Chosen in the Publish dialog (list from the account, cached, Refresh) or Scraps; last choice remembered |
| 5 | DeviantArt AI | `is_ai_generated: true` + `noai: true` by default (Settings) |
| 6 | DeviantArt upload | Session API like PostyBirb: `submit/upload/deviation` → `attachments/add` (images 2…10) → `_napi/shared_api/deviation/update` (JSON, `editorRaw` = TipTap doc) → `deviation/publish` → url |

## Decisions — DeviantArt age check (2026-11-14)

| # | Topic | Choice |
|---|---|---|
| 1 | Canon age | AniList GraphQL `Character.age` (search by name, pick the one whose media matches the series, else exact name); lowest number in the text (part/season numbers ignored, "teen" → 15) |
| 2 | Looks young | Danbooru `counts/posts`: `<tag> loli` / `<tag>`. Calibrated: Kanna 36 %, Illya 22 %, Anya 12 % vs adults ≤ 1 %. `child` ignored (polluted by co-appearances: Yor 17 %) |
| 3 | Levels | 🔺 minor: age < 18 or loli ≥ 10 % · 🟠 young: loli 3–10 % · ❔ unknown age · adult otherwise (`shared/age.ts`) |
| 4 | UI | Triangle in Characters table/header/editor, inspector chips, Publish dialog (DeviantArt only) with mandatory "I understand the risk" checkbox |
| 5 | Matching in Publish | prompt/LoRA detection + name tags (not series tags) |

## Decisions — Civitai, X, SubscribeStar (2026-11-14)

| # | Topic | Choice |
|---|---|---|
| 1 | Civitai | Browser session on **civitai.red** (NSFW side; civitai.com is SFW-only since 2026-04, same DB). From their open-source front-end: `POST /api/v1/image-upload` `{filename}` → `{id, uploadURL}` → raw `PUT` (from Node) → tRPC `post.createWithImages` `{json:{title, detail, tags, publish:true, images:[{url:id, index, width, height, mimeType, meta}]}}`. Meta = prompt/negativePrompt/cfgScale/steps/sampler/seed/Model/resources (required for R-18 on .red) |
| 2 | X | Drive the real compose form (`tweetTextarea_0`, `fileInput`, `attachments`, `tweetButton`); text typed line by line (Enter between lines); R-18 → `page.route('**/CreateTweet')` + `route.fallback({postData})` sets `variables.media.possibly_sensitive = true`; tweet id from the CreateTweet response. Login = cookies `auth_token` + `twid` |
| 3 | SubscribeStar | **subscribestar.adult** (.art redirects). PostyBirb flow: `/profile/settings` (login, tiers, creator page) → creator page `data-form-template` (S3 path/url, authenticity_token) → `presigned_url/upload` → S3 POST (from Node) → `post_uploads/process_s3_attachments.json` → `post_uploads/reorder` → `posts.json` (html_content, tags[], tier_ids[], `Publish Now`) |
| 4 | SubscribeStar visibility | Public or tiers picked in the Publish dialog (cached list, Refresh, remembered) |
| 5 | SubscribeStar title | `<strong>title</strong>` on the first line, then the description |
| 6 | Age warning | DeviantArt: any flagged character. Other sites: flagged character in an R-18 image. Mandatory "I understand the risk" |

## Design
Dark, flat, red accent `#e5383b`. Manrope (UI) + JetBrains Mono (tags, values). No shadows, 1px borders, 6–14px radii.

## Steps
1. ✅ Skeleton, design system, batch import, grid, selection (click / Ctrl / Shift / Ctrl+A), inspector (title, tags add/replace/remove, description, SFW/R-18), presets, ComfyUI metadata
2. ✅ Per-platform tabs in the inspector (title/tags/desc override, revert to common), limits + counters, resolved preview (X text, normalised tags), tag rules in Settings (`shared/platforms.ts`)
3. ✅ Accounts (dedicated Edge window, persistent profile `data/browser-profile`), queue with per-platform delay + scheduling, history, "posted" badges, Pixiv upload via `/ajax/work/create/illustration` called from the session (fields modelled on PostyBirb). ✅ Verified on a real account.
   - The response only holds a `convertKey`: we poll `GET /ajax/work/create/illustration/progress?convertKey=…` (1 s, max 2 min) → `{status: RUNNING|COMPLETE|FAILURE, illustId}` → link `/artworks/<id>`.
   - Headless Edge is blocked by Cloudflare on Pixiv → always windowed; "hide" = window off-screen.
   - `ARTPOST_MOCK=1 npm run start` simulates Pixiv (queue tests without network).
4. ✅ English UI + character auto-tag (`shared/autotag.ts`, `server/src/characters.ts`, `client/src/pages/Characters.tsx`)
5. ✅ Pixiv short auto-title, tag presets (page + chips), DeviantArt (`server/src/platforms/deviantart.ts`). **DeviantArt to validate on a real account.**
6. ✅ DeviantArt age check (AniList + Danbooru, `scripts/e2e-age.mjs`, calibration `scripts/probe-young.mjs`)
7. ✅ Civitai (civitai.red), X (compose form), SubscribeStar Adult — `scripts/test-adapters.ts`, `scripts/e2e-platforms.mjs`. **All three to validate on real accounts.**

## Security
- HTTP serves only `data/originals` and `data/thumbs` (never the DB or the logged-in Edge profile).
- CORS only allows `http://127.0.0.1:*` / `http://localhost:*`, so other websites can't call the API.

## Structure
```
shared/       platforms.ts (limits, tag normalisation, override > common)  autotag.ts (detection, tag/title generation)
server/src/   index.ts (Fastify)  images.ts  db.ts  png-meta.ts  accounts.ts (login)  jobs.ts (queue + worker)
              browser.ts (Playwright/Edge)  settings.ts  characters.ts (list, Danbooru, AniList, auto-tag)
              platforms/{pixiv,deviantart,civitai,x,subscribestar,http,types,index}.ts
client/src/   App.tsx  lib/{store,api,types}.ts  components/  pages/
data/         artpost.db  originals/  thumbs/  browser-profile/      (git-ignored)
scripts/      e2e-*.mjs  test-autotag.ts  test-pixiv-multipart.ts  test-deviantart.ts (real adapters, simulated network)
              tests on a copy: ARTPOST_DATA=<dir> [ARTPOST_MOCK=1] PORT=3299 npm run start
```
