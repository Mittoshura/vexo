# VEXO — quick start

## 1. Install (once)

1. Install Node.js 22 LTS or newer from https://nodejs.org (keep the default options).
2. Unzip VEXO anywhere, for example `C:\VEXO`.
3. Double-click `Start.bat`. The first launch installs what it needs (a minute or two), then VEXO opens in your browser at http://127.0.0.1:3210.

Keep the black window open while you use VEXO. Close it to stop VEXO.

## 2. Connect your sites

1. Open **Platforms** in the left menu.
2. Click **Log in** next to a site. An Edge window opens on that site's login page.
3. Log in as usual (2FA included). The window closes by itself once you're in.

Repeat for each site you use. You stay logged in between sessions.

## 3. Import and tag

1. Open **Library** and drag your PNGs into the window (or click **Import**).
2. Select images: click, Ctrl+click to add, Shift+click for a range, Ctrl+A for all.
3. In the panel on the right, fill in the title, tags and description, then click **Apply** (or Ctrl+Enter). With several images selected, only the fields you touch are changed.
4. Optional: the site tabs (Pixiv, DA, Civitai, X, SubStar) let you use a different title or tags on one site.

## 4. Characters (optional, recommended)

1. Open **Characters**, type a name in the search box and pick the Danbooru tag.
2. Check the names and the age box, then click **Add to list**.
3. New imports are tagged automatically. For images already in the Library, select them and click **Auto-tag**.
4. In **Settings → Auto-tag**, choose English or Japanese tags.

A red triangle means the character is a minor in canon or is mostly drawn young. Be careful with it on DeviantArt, and with R-18 images anywhere.

## 5. Presets

Open **Presets** → **New preset**, give it a name and some tags. In the Library, the preset appears under **Tag sets**: one click adds its tags to every selected image, another click removes them.

## 6. Publish

1. Select images and click **Publish**.
2. Pick the site, then **1 multi-image post** or **1 post per image**.
3. Pick **As soon as possible** or **Schedule**, plus the site's options (Pixiv visibility, DeviantArt folder, SubscribeStar tiers).
4. Click **Queue**.

Posts go out one at a time from the **Queue** page. Each site has its own delay between posts (**Settings**, 10 minutes by default). Finished posts move to **History** with a link to each one. If a post fails, open it in History to see what happened and click **Retry**.

## Good to know

- An Edge window appears while VEXO posts. In **Settings** you can move it off-screen. It can't be fully hidden, because Pixiv blocks invisible browsers.
- Everything is stored in the `data` folder next to `Start.bat`. Delete that folder to start from scratch.
- To update VEXO, replace every file except the `data` folder.
