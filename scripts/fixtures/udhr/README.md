# UDHR fixture — a parallel corpus for language-neutrality tests

Nine translations of the **Universal Declaration of Human Rights**, used by
`scripts/test-omnilingual-gate.mjs`.

## Why this document

It is the same text in every file. That is the whole point: a claim-detector
that is genuinely language-neutral should flag a comparable density of
checkable atoms in all nine, because all nine state the same facts. Any large
divergence is a property of the detector, not of the content — which makes this
a controlled measurement rather than a sample of nine unrelated documents.

It also has a useful internal regularity: 30 numbered articles, so every
translation contains the same 51 numerals. That turns numeral detection into a
controlled comparison too.

## Why these nine

Chosen to cover the orthography and numeral systems that break a
capitalization-and-ASCII-digits detector in opposite directions:

| File | Language | Why it is here |
|---|---|---|
| `udhr-eng.txt` | English | baseline the detector was written against |
| `udhr-042.txt` | Spanish | ordinary Latin script, sentence-case |
| `udhr-deu_1996.txt` | German (1996) | **capitalizes every noun** — the over-firing case LAWS.md L4 predicted |
| `udhr-rus.txt` | Russian | Cyrillic, has case distinction |
| `udhr-arb.txt` | Arabic | uncased, but ASCII digits — isolates the capitalization cause |
| `udhr-kor.txt` | Korean | uncased, ASCII digits — same isolation, different script |
| `udhr-hin.txt` | Hindi | uncased **and** Devanagari numerals — both causes |
| `udhr-urd.txt` | Urdu | uncased **and** Extended Arabic-Indic numerals — both causes |
| `udhr-pes_1.txt` | Farsi (Western) | uncased, numbers spelled out — neither digit system |

Arabic and Korean are the control that separates the two root causes: uncased
like Hindi and Urdu, but writing the article numbers in ASCII, so they measure
exactly 30 number atoms and zero name atoms. Hindi and Urdu write those same
numerals natively and measure zero of both.

## Why Chinese, Japanese and Thai are not here

They were in an earlier version and were removed deliberately. The metric is
atoms **per word**, and an unspaced script has no meaningful word count —
Japanese measured 233 atoms/1k against a denominator of 90 "words" for a
4,070-character document. That is a denominator artifact, not an over-fire, and
leaving it in would have overstated the finding. Measuring those scripts
honestly needs a different metric, so they are out of this comparison rather
than silently distorting it.

## Vendored, not referenced

Copied in rather than read from `live_priors` so the suite stays hermetic: it
runs today against a bare checkout with no `node_modules` and no submodule, and
a fixture reached by an absolute path outside the repo would end that.

Each file keeps its four-line English metadata header (title, `Language:`,
`Adopted:`, `Publisher:`). The test strips those lines before measuring — they
are identical across all nine and would otherwise hand every language the same
English proper nouns and ASCII digits, flooring the zero-atom languages at a
false non-zero. One of the passing tests guards that strip.

## Provenance

- **Source:** `live_priors/06-government-legal/un-udhr/` (516 translations)
- **Institution:** United Nations General Assembly / OHCHR
- **Licence:** Public domain (UN General Assembly resolution 217 A (III))
- **Notice:** Universal Declaration of Human Rights, Office of the UN High
  Commissioner for Human Rights. Unicode encodings via
  `github.com/wooorm/udhr`.
