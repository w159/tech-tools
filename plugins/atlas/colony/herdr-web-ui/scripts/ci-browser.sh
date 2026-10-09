#!/usr/bin/env bash
# The browser lane of CI: the lockfile's Playwright Chromium, then the scripts that drive it.
set -euo pipefail
bun node_modules/playwright-core/cli.js install --with-deps chromium
CHROME_PATH="$(bun -e 'console.log(require("playwright-core").chromium.executablePath())')"
export CHROME_PATH
bun scripts/ui-regression.ts
bun scripts/chat-history-browser-qa.ts
bun scripts/math-browser-qa.ts
bun scripts/file-viewer-regression.ts
bun scripts/keyboard-viewport-regression.ts
bun scripts/file-viewer-mobile-regression.ts
bun scripts/droplet-demo-regression.ts
bun scripts/chat-greeting-demo-regression.ts
bun scripts/composer-fit-demo-regression.ts
bun scripts/held-rows-demo-regression.ts
bun scripts/prompt-dock-demo-regression.ts
bun scripts/machine-dialog-regression.ts
