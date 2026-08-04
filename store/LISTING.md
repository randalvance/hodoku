# Chrome Web Store listing

Everything the Developer Dashboard asks for, ready to paste. Upload the zip from
`release/` at <https://chrome.google.com/webstore/devconsole>.

---

## Store listing tab

**Item name** (45 char max)

```
Hodoku — Japanese Sentence Breakdown
```

**Summary** (132 char max)

```
Highlight Japanese text to see it in romaji, with a word-by-word breakdown, readings, and meanings. Works offline.
```

**Category:** Education
**Language:** English

**Description**

```
Reading Japanese gets a lot easier when you can see how a sentence is built.

Highlight any Japanese text on any page and Hodoku shows you:

• The whole sentence in romaji, using proper Hepburn spelling — tōkyō, not toukyou
• The kana reading, with furigana above each kanji
• A word-by-word breakdown: dictionary form, part of speech, how the word is inflected, and what it means
• Plain-English notes on particles and auxiliaries — what は, を, に, and ます are actually doing
• A save button, so anything worth revisiting goes onto a review list

It works entirely offline. The Japanese dictionary and the morphological analyser are bundled with the extension, so there is no account, no sign-up, and nothing is sent anywhere while you read.

HOW IT WORKS

Select some Japanese and a small "Romaji" button appears. Click it, or press Alt+R, or right-click and choose "Show romaji and breakdown". You can also turn on automatic mode so the panel opens as soon as you finish selecting.

ROMAJI THE WAY YOU WANT IT

Four styles, switchable in the options:
• Modified Hepburn — tōkyō (what dictionaries and road signs use)
• Doubled vowels — tookyoo
• No long vowels — tokyo
• Keyboard spelling — toukyou (what you type on a Japanese IME)

Long vowels are resolved from how a word is actually pronounced, not from how it is spelled — so 王 comes out as "ō" while 追う correctly stays "ou".

ACCURATE WORD SPLITTING

Japanese does not put spaces between words, so a good breakdown depends on good segmentation. This extension uses kuromoji with the IPADIC dictionary — the same morphological analysis approach used by professional Japanese text tools — to find word boundaries, readings, and inflections. Meanings come from JMdict, the standard open Japanese-English dictionary, with over 200,000 entries.

OPTIONAL AI TRANSLATION

If you want a fluent, natural translation of the whole sentence, you can add your own API key in the options — either Anthropic (Claude) or OpenAI (GPT), whichever you already have. This is off by default and completely optional: romaji, readings, and word meanings all work without it. Translations are cached locally, so re-reading the same sentence never costs a second API call — and a Regenerate button lets you ask again, or ask the other provider, whenever an answer is not quite right. The extension only asks for network permission if you turn this on, it only asks for the provider you picked, and your key is stored in your own browser and sent only to that provider.

SAVE WHAT YOU WANT TO REMEMBER

Click the bookmark on any sentence to save it. The review page collects everything you have saved, with search and a flashcard study mode.

When you are ready to study properly, send them straight into Anki. With the AnkiConnect add-on installed, saved sentences become real Anki cards in a deck you choose — with furigana above the kanji on the answer side — so you get proper spaced repetition and Anki's own sync to your phone. This runs entirely over your own computer's loopback; nothing goes to the internet. You can also export tab-separated or JSON files.

FOR LEARNERS

Built for anyone reading Japanese above their level: news articles, blog posts, game text, Twitter, novels. If you are working through kanji study and keep hitting words you can nearly read, this fills in the gap without making you leave the page.

NO ACCOUNT, NO TRACKING

There is no sign-up, no analytics, and no telemetry. The extension requests no network access at all when you install it — the only hosts it can ever reach are the ones you explicitly turn on, and it asks for those at the moment you enable them.
```

---

## Privacy tab

**Single purpose description**

```
Hodoku converts Japanese text that the user highlights into romaji and shows a word-by-word linguistic breakdown with English meanings. Every feature in the extension serves that one purpose.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| `storage` | Stores the user's own settings (romaji style, whether the selection button appears, theme), the sentences they explicitly choose to save for review, a local cache of translations already produced (so the same sentence is not sent twice), and — only if they enable the optional AI translation feature — their own Anthropic and/or OpenAI API key. Nothing is stored remotely. |
| `offscreen` | The Japanese morphological analyser and its ~26 MB of dictionary data are loaded once into an offscreen document. Service workers are terminated when idle, which would force a full reload of the dictionaries on every lookup and make the extension unusably slow. |
| `contextMenus` | Adds a single "Show romaji and breakdown" item that appears only when text is selected, as an alternative to the floating button. |
| Host permission: `<all_urls>` (content script) | The extension's purpose is to explain Japanese text wherever the user encounters it. The content script only reads the text the user has actively selected, and only acts when that selection contains Japanese characters. It does not read page content otherwise, and sends nothing anywhere. |
| Optional host permissions: `http://127.0.0.1/*`, `http://localhost/*` | Requested at runtime, only if the user turns on the optional Anki export feature. Used solely to reach the AnkiConnect add-on running in Anki on the user's own computer, so saved sentences can become Anki cards. Loopback only — these origins cannot reach any remote server. |
| Optional host permissions: `https://api.anthropic.com/*`, `https://api.openai.com/*` | Requested at runtime, only if the user turns on the optional AI translation feature, and only for the single provider they select — never both. Used solely to send the selected sentence to that provider's API with the user's own API key. Permission for the other provider is revoked when the user switches. Never requested otherwise. |

**Remote code:** No. All code is included in the package. Nothing is fetched or evaluated at runtime.

**Data usage disclosures**

- Does the extension collect *personally identifiable information*? **No**
- *Health information*? **No**
- *Financial and payment information*? **No**
- *Authentication information*? **Yes** — the user's own Anthropic and/or OpenAI API key, if and only if they choose to enable AI translation. Keys are stored locally in `chrome.storage.local` and each is transmitted only to its own provider (`api.anthropic.com` / `api.openai.com`) to authenticate the user's own requests. They are never sent to the developer or any third party.
- *Personal communications*? **No**
- *Location*? **No**
- *Web history*? **No**
- *User activity*? **No**
- *Website content*? **Yes** — sentences the user explicitly saves for review are stored locally in their own browser (never transmitted anywhere), and, only when AI translation is enabled, the specific text the user selects, is sent to the user's chosen provider (Anthropic or OpenAI) to be translated. With AI translation off (the default), no selected text ever leaves the browser.

Certifications (all three must be checked):
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** mandatory, because the extension handles an API key.
Google fetches this URL anonymously, so it must resolve **without a login**.

If the source repository is private, a link into it will not work — a GitHub
blob or raw URL on a private repo returns 404 to Google. Publish the contents of
`store/PRIVACY.md` at one of these instead:

| Option | Command / note |
|---|---|
| Public Gist | `gh gist create store/PRIVACY.md --public` — prints the URL |
| GitHub Pages | A small public repo containing just the policy |
| Your own site | e.g. a `/hodoku/privacy` page |

Re-publish it whenever the policy changes; the store keeps fetching the live
URL, not a snapshot taken at review time.

---

## Graphic assets

| Asset | Size | Status |
|---|---|---|
| Store icon | 128×128 PNG | `store/assets/store-icon-128.png` — generated by `npm run build:icons` |
| Screenshots | 1280×800 PNG (up to 5) | `store/assets/preview-*.png` — generated by `npm run build:screenshots` |
| Small promo tile | 440×280 PNG | Optional. Only needed to be considered for featuring. |
| Marquee promo tile | 1400×560 PNG | Optional. |

At least one screenshot is required; five is the maximum and all five slots are
filled. `npm run build:screenshots` loads the built extension into a real
Chrome, drives it — selecting text, opening the panel, saving items, entering
study mode — and captures each result at exactly 1280×800. Nothing is mocked, so
a screenshot cannot drift from what the extension actually does.

| File | Shows |
|---|---|
| `preview-1-breakdown.png` | The panel over an article: romaji, kana, meaning, word breakdown |
| `preview-2-particles.png` | Scrolled to the particle rows, with their usage notes |
| `preview-3-dark.png` | Dark theme, and Hepburn long vowels (Tōkyōeki) |
| `preview-4-saved.png` | The review list with several saved sentences |
| `preview-5-study.png` | Flashcard study mode with the answer revealed |

Every shot uses the **offline word-by-word gloss**, not an AI translation — AI
translation is off by default, so this is what a new user actually sees. Showing
a fluent model translation would misrepresent the default experience and is the
kind of thing review takes issue with.

To re-shoot after a UI change: `npm run build && npm run build:screenshots`.

---

## Before you submit

- [ ] Bump `version` in **both** `package.json` and `src/manifest.json` — `npm run package` refuses to build if they disagree
- [ ] `npm run release` — builds icons, dictionary, bundle, runs tests, and zips
- [ ] Load `dist/` unpacked at `chrome://extensions` and confirm the panel works on a real Japanese page
- [ ] Confirm the Anki export toggle prompts for loopback permission, and that Test connection succeeds against a running Anki with AnkiConnect
- [ ] Confirm the AI translation toggle prompts for the selected provider's host permission, that switching provider prompts for the new host and drops the old one, and that declining leaves the rest of the extension working
- [ ] Publish the privacy policy at a public URL and paste it into the Privacy tab
- [ ] Check the item name does not collide with an existing trademark (see the note in `README.md`)

Review usually takes a few days. Broad host permissions and an API-key field
both attract manual review, so expect the longer end of that range.
