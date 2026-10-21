# Embedded export fonts

Unmodified Liberation fonts from the local Debian fonts-liberation package.
Package version: 1:2.1.5-3build1
Upstream: https://github.com/liberationfonts
License: SIL Open Font License 1.1 (see LICENSE-Liberation.txt).

SHA-256:

- `LiberationSans-Regular.ttf`: `075e71be4c58beda172ecb574a799308f04c3d054c6a5b7434954d3b0f1b28d8`
- `LiberationSans-Bold.ttf`: `b72c65e551d653b54217ffad0d1454ce0657e4e8d4a28bcc79e0acd2598f4bf3`
- `LiberationSerif-Regular.ttf`: `350f4ffd773cae53560c63dca3d89a5070595614fde12f772bf43feb63d81064`
- `LiberationSerif-Bold.ttf`: `bb033fae52dcbf67a55494a08829aaa788324624d72a195af7f93da3061c928f`

The legacy WOFF2 files are retained for rollback; exports embed the static TTF assets.

## Carlito

Unmodified regular and bold fonts from the local Debian fonts-crosextra-carlito package.
Package version: 20230309-2
Upstream: https://github.com/googlefonts/carlito
License: SIL Open Font License 1.1 (see LICENSE-Carlito.txt).

- `Carlito-Regular.ttf`: `f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595`
- `Carlito-Bold.ttf`: `bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db`

The three single-family export choices use Liberation Sans for Arial-style, Carlito for Calibri-style, and Liberation Serif for Times New Roman-style. Labels identify the actual bundled substitutes; Microsoft font files are not included.
