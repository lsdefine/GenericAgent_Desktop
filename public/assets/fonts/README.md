# Desktop Font Assets

These font files are the offline Latin bundle for the vanilla desktop shell.

## Files

- `lexend-latin.woff2`
  - Role: brand wordmark (offline variable font, weights 100–900)
  - Source: Google Fonts CSS2 API, specimen page <https://fonts.google.com/specimen/Lexend>
  - Downloaded: 2026-05-25
  - License: SIL Open Font License 1.1 (see the corresponding `OFL-*.txt` file below)

- `noto-sans-latin.woff2`
  - Role: English body copy and default Latin UI text
  - Source: Google Fonts CSS2 API, specimen page <https://fonts.google.com/noto/specimen/Noto+Sans>
  - Downloaded: 2026-05-25
  - License: SIL Open Font License 1.1 (see the corresponding `OFL-*.txt` file below)

- `jetbrains-mono-latin.woff2`
  - Role: config/value dense controls and numeric surfaces
  - Source: Google Fonts CSS2 API, specimen page <https://fonts.google.com/specimen/JetBrains+Mono>
  - Downloaded: 2026-05-25
  - License: SIL Open Font License 1.1 (see the corresponding `OFL-*.txt` file below)

## Notes

- Only Latin subsets are bundled here. Chinese UI text continues to use the existing system fallback stack.
- Runtime does not fetch fonts from a CDN. `fonts.css` defines the legacy shell brand and monospace fonts. Noto Sans is retained as an available asset; body and Chinese text use system fonts.
- `public/assets/fonts/` is copied into the Vite build; `static/assets/fonts/` serves the legacy shell. Keep both directories synchronized.

## License files and attribution

The repository's MIT license does not replace these font licenses.
The font binaries are unmodified; their embedded copyright notices are retained.

- Lexend: [OFL-Lexend.txt](OFL-Lexend.txt), from <https://github.com/google/fonts/blob/main/ofl/lexend/OFL.txt>.
  The bundled binary records: Copyright 2019 The Lexend Project Authors (https://github.com/googlefonts/lexend).
  The upstream license additionally retains the 2018 notice and reserved font name.
- Noto Sans: [OFL-NotoSans.txt](OFL-NotoSans.txt), from <https://github.com/google/fonts/blob/main/ofl/notosans/OFL.txt>.
- JetBrains Mono: [OFL-JetBrainsMono.txt](OFL-JetBrainsMono.txt), from <https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt>.

Upstream license texts retrieved on 2026-10-23. Include these notices when redistributing the fonts.
