'use strict';

// ANSI escape sequences: CSI (e.g. colors "ESC[0;32m", cursor movement), OSC (e.g. titles/links,
// terminated by BEL or ESC \) and the remaining two-character escapes.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Removes ANSI escape sequences, which VS Code output channels show as garbage like "[0;32m". */
export const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '');
