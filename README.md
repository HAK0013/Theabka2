# ធៀបការឌីជីថល · Khmer wedding e-invitation

Vite static site, in this order: envelope → opening → cover → invitation words → couple →
countdown → programme → love story → candlelight → gallery → venue → wedding gift → thank you.
Every section works with placeholders until you fill in `src/data/wedding.js`.

## Edit your details

| What | Where |
|---|---|
| Names, parents, date, lunar date, venue, map pin, photos, music, colours | `src/data/wedding.js` |
| Programme (times, ceremonies, icons), love-story captions, gift QR codes | `src/data/wedding.js` |
| Every interface sentence (Khmer + English), incl. the formal invitation wording | `src/i18n.js` |
| One section's layout or motion | `src/sections/<name>.js` + `src/styles/sections.css` |

Search `wedding.js` for **✏️ TODO**: those are the placeholders still waiting for real details.
The cover's weekday / day / month / year are written automatically (Khmer numerals in Khmer mode)
from `date.iso`.

## Commands

```bash
npm install
npm run dev        # local preview at http://localhost:5173 (also on your phone over Wi-Fi)
npm run photos     # photos/originals → public/photos/*-{640,1280,2000}.webp, GPS/EXIF removed, writes src/data/gallery.json
npm run og         # renders public/og.jpg (1200×630 link preview). Run after names + cover photo are in.
npm run build      # production build → dist/
```

`npm run og` needs a Playwright browser once: `npx playwright install chromium`.

## Photos
1. Put originals in `photos/originals/` (this folder is git-ignored, so originals never get published).
2. `npm run photos`
3. In `wedding.js`, set `photos.cover: 'IMG_2041'` (file name, no extension).

## Gift QR codes
Put the images in `public/gifts/` and list them under `gifts` in `wedding.js`
(label, image path, account holder, bank). Each card gets a Save QR button.

## Music
Put an mp3 in `public/music/` and set `music: '/music/your-song.mp3'`. It starts on the envelope tap.

## Colours from your printed card
Change `palette` in `wedding.js`: `paper`, `paperLight`, `paperDeep`, `cream`, `ink`, and the
`foil` gradient stops (dark → highlight → dark). Starter-kit textures go in `textures`.

## Deploy (private GitHub repo + Vercel)
```bash
git init && git add . && git commit -m "Wedding invitation"
gh repo create our-wedding --private --source=. --push   # or create the repo on github.com and push
```
Then on vercel.com → **Add New → Project → Import** the repo → Deploy (Vite is detected automatically).
Copy the live link into `site.url` in `wedding.js`, run `npm run og`, commit and push again so the
Telegram / Messenger preview uses the absolute image URL.

