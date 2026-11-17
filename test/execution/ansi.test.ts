import * as assert from 'assert';
import { stripAnsi } from '../../src/execution/ansi';

suite('stripAnsi', () => {
    test('should remove color codes of gauge console output', () => {
        assert.strictEqual(
            stripAnsi('\x1b[0;32m ✔\x1b[0m\x1b[0;32m ✔\x1b[0m2026-11-17T13:54:54,644 [DEBUG] done'),
            ' ✔ ✔2026-11-17T13:54:54,644 [DEBUG] done');
        assert.strictEqual(stripAnsi('\x1b[0;36m# MOD4 - tc8249 [CF] Request'), '# MOD4 - tc8249 [CF] Request');
    });

    test('should remove other CSI, OSC and two-character escapes', () => {
        assert.strictEqual(stripAnsi('a\x1b[2K\x1b[1Gb\x1b[?25lc'), 'abc');
        assert.strictEqual(stripAnsi('\x1b]0;title\x07x\x1b]8;;http://example.org\x1b\\y'), 'xy');
        assert.strictEqual(stripAnsi('a\x1bMb'), 'ab');
    });

    test('should keep text without escapes unchanged', () => {
        const text = 'Specification: specs/example.spec:19 [a] ✔ ü € 100% ${VAR}';
        assert.strictEqual(stripAnsi(text), text);
    });
});
