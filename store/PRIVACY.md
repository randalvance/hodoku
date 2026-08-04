# Privacy Policy — Hodoku

_Last updated: 3 August 2026_

## The short version

Hodoku analyses Japanese text entirely on your own computer. It has no
servers, no analytics, no accounts, and no telemetry. Nothing you read or select
is sent anywhere unless you personally turn on the optional AI translation
feature and supply your own API key.

## What the extension stores

All of this lives in `chrome.storage.local` in your own browser profile and is
never transmitted to the developer:

- Your display preferences: romaji style, furigana on or off, whether the
  selection button appears, automatic analysis on or off, and panel theme.
- Sentences you explicitly save for review, together with the reading, the
  meaning the panel showed (including any model translation, literal rendering
  and grammar note, and which model produced them), and the page address they
  came from. Nothing is saved
  unless you click the bookmark or use "Save for review".
- Translations already produced, cached locally so the same sentence is not sent
  to a provider twice. Clearing the cache is a button in the options page.
- Your Anthropic and/or OpenAI API key — **only** if you enable AI translation and
  enter one. Keys are stored per provider so switching between them does not
  require re-entering anything.

Uninstalling the extension deletes all of it.

## What the extension reads

The content script runs on pages so it can see what you have selected. It reads
the current text selection, and only when that selection contains Japanese
characters. It does not scan, index, or transmit page content, and it does not
track which pages you visit.

## What is sent over the network

**With the default settings: nothing.** The extension requests no host
permissions at install time. The Japanese dictionaries are bundled in the
package, so analysis is fully offline.

**If you enable AI translation:** you choose a provider — Claude (Anthropic) or
GPT (OpenAI) — and Chrome asks you to grant permission for that provider's host
(`https://api.anthropic.com` or `https://api.openai.com`). Permission is
requested for the selected provider only, and the other one is revoked when you
switch. If you accept, then each time you analyse a selection the extension
sends the following to that provider's API, authenticated with your own API key:

- the Japanese text you selected, and
- the readings and dictionary entries the extension computed for it.

Nothing else is included — no URL, no page title, no browsing history, no
identifier for you or your machine. The provider's handling of that request is
governed by their own terms and privacy policy, which apply to your account:

- Anthropic — <https://www.anthropic.com/legal/privacy>
- OpenAI — <https://openai.com/policies/privacy-policy>

Requests are sent with storage disabled where the provider supports it, and the
extension never sends your data to more than the one provider you selected.

**If you enable Anki export:** Chrome asks for permission to reach
`http://127.0.0.1` and `http://localhost` — your own machine only. Saved
sentences are then sent to Anki running locally, over your computer's network
loopback. This traffic never reaches the internet and no remote party is
involved.

You can turn either feature off at any time in the extension's options, which
also revokes the corresponding permission.

## What the developer receives

Nothing. There is no backend. The developer cannot see your API key, your
selections, or any usage data.

## Data sharing and sale

No data is collected, so none is shared, sold, or transferred to anyone. Data is
never used for advertising, credit assessment, or lending.

## Children

The extension is a reading aid for Japanese text and is not directed at
children under 13. It collects no personal information from anyone.

## Changes

Material changes to this policy will be published with a new version of the
extension and reflected in the date above.

## Contact

Open an issue on the project's repository.
