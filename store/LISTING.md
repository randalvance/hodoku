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

OPEN SOURCE

Source code, build scripts, and the dictionary compilation pipeline are all public.
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

**Privacy policy URL:** host `store/PRIVACY.md` somewhere public (a GitHub Pages
site or the repository's raw URL both work) and paste the link here. A privacy
policy URL is mandatory because the extension handles an API key.

---

## Graphic assets

| Asset | Size | Status |
|---|---|---|
| Store icon | 128×128 PNG | `store/assets/store-icon-128.png` — generated by `npm run build:icons` |
| Screenshots | 1280×800 PNG (up to 5) | `store/assets/preview-*.png` — generated by `npm run build:screenshots` |
| Small promo tile | 440×280 PNG | Optional. Only needed to be considered for featuring. |
| Marquee promo tile | 1400×560 PNG | Optional. |

At least one screenshot is required. `npm run build:screenshots` renders the
pages *and* captures them to PNG at exactly 1280×800, so the files are ready to
upload as-is. The matching `.html` files are kept alongside them if you want to
tweak the copy and re-shoot.

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
