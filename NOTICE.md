# Third-party notices

Hodoku redistributes the following components. Both are bundled in the
extension package, so these notices ship with every build and are surfaced to
users on the extension's options page.

---

## kuromoji.js

Japanese morphological analyser. Used for word segmentation, readings, and
inflection.

- Project: <https://github.com/takuyaa/kuromoji.js>
- Copyright 2014 Takuya Asano; Copyright 2010–2014 Atilika Inc. and contributors
- Licence: Apache License, Version 2.0 — <https://www.apache.org/licenses/LICENSE-2.0>

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## IPADIC

The dictionary kuromoji is built against, redistributed inside the kuromoji
package as the compiled `*.dat.gz` files under `dict/kuromoji/`.

- Copyright 2000, 2001, 2002, 2003 Nara Institute of Science and Technology
- Licence: Apache License, Version 2.0, as redistributed by the kuromoji project

## JMdict

Japanese–English dictionary. Used for the English meanings shown in the
breakdown. Compiled into `dict/jmdict.bin` by `scripts/build-dict.mjs` from the
[jmdict-simplified](https://github.com/scriptin/jmdict-simplified) JSON
distribution.

- Project: <https://www.edrdg.org/jmdict/j_jmdict.html>
- Copyright © the Electronic Dictionary Research and Development Group (EDRDG)
- Licence: Creative Commons Attribution-ShareAlike 4.0 International
  (CC BY-SA 4.0) — <https://creativecommons.org/licenses/by-sa/4.0/>

The JMdict files are the property of the Electronic Dictionary Research and
Development Group, and are used in conformance with the Group's licence. The
compiled table in this project is a derivative work of JMdict: entries are
re-encoded into a lookup structure and senses are truncated for size. It is
redistributed under the same CC BY-SA 4.0 licence.

The exact JMdict release used for a given build is recorded in
`public/dict/jmdict.meta.json`.

## @anthropic-ai/sdk

Client for the optional Claude translation feature.

- Project: <https://github.com/anthropics/anthropic-sdk-typescript>
- Licence: MIT

## openai

Client for the optional GPT translation feature.

- Project: <https://github.com/openai/openai-node>
- Licence: Apache License, Version 2.0

## AnkiConnect (not bundled)

The optional Anki export talks to the AnkiConnect add-on over the user's own
network loopback. No AnkiConnect code is redistributed with this extension; only
its documented HTTP API is used.

- Project: <https://github.com/FooSoft/anki-connect>

---

## A note on ShareAlike

CC BY-SA 4.0 applies to the JMdict-derived dictionary data, not to this
project's own source code, which is MIT-licensed (see LICENSE). Redistributing
the compiled dictionary — including inside a published extension package —
requires keeping the attribution above and licensing that data onward under
CC BY-SA 4.0. Both conditions are met by this repository and by the packaged
extension.

Note that CC BY-SA has no source-disclosure requirement of the kind the GPL has:
the obligation attaches to the dictionary data, not to the code that reads it.
Keeping this repository private is therefore compatible with it, because the
attribution travels with the distributed data — it is rendered on the
extension's own options page, which every user can see.
