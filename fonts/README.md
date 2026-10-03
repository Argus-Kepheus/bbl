# Local Computer Modern fonts

Runtime font assets are self-hosted. No CDN or external font service is used.

- `cmu-serif-roman.woff2`
- `cmu-serif-bold.woff2`
- `cmu-serif-italic.woff2`
- `cmu-serif-bolditalic.woff2`
- `OFL.txt`, `OFL-FAQ.txt` — SIL Open Font License 1.1 (must stay with the fonts).

Computer Modern Unicode fonts by Andrey V. Panov, from the web-font kit compiled by
Christian Perfect, converted to WOFF2 on 2026-09-30. Provenance, face mapping and how to
regenerate them: `../../docs/FONTS.md`.

`tools/build_web.py` refuses a production build when any of the four files is absent.
