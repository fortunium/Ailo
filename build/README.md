# App icon

`icon-source.png` is the selected artwork generated with the built-in imagegen
tool. `npm run icons` creates `icon.png` (512px), `icon.ico` (16–256px) and the
matching copies in `src/renderer/public/`. These serve the window, sidebar,
notifications, favicon and desktop packaging. The command uses the installed
Electron runtime and does not call an image API.

Generation prompt:

> Create one polished square desktop app icon for Ailo, an app for AI coding conversations. A friendly, minimal geometric monogram combining a capital A and a terminal prompt chevron, with a small mint chat spark. Rich midnight navy rounded-square tile, luminous periwinkle blue main mark, mint accent. Strong bold simple silhouette, crisp vector-like edges, subtle carefully restrained depth and gradient, generous padding, centered, readable at 24 pixels. No written words, no letters other than the abstract A mark, no extra objects, no mockup, no border outside the tile, no shadows beyond the icon. Transparent corners outside the rounded square. Output a single icon filling the square image.
