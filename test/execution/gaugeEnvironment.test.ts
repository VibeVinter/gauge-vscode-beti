import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseProperties, resolveGaugeDataDir } from '../../src/execution/gaugeEnvironment';

suite('Gauge Environment Tests', () => {
    suite('parseProperties', () => {
        test('should parse key/value pairs and skip comments', () => {
            assert.deepStrictEqual(parseProperties([
                '# comment',
                '! other comment',
                '',
                'gauge_data_dir=testdata/mod3',
                ' spaced : value with spaces ',
                'blank='
            ].join('\n')), {
                gauge_data_dir: 'testdata/mod3',
                spaced: 'value with spaces',
                blank: ''
            });
        });
    });

    suite('resolveGaugeDataDir', () => {
        let root: string;
        const write = (rel: string, content: string) => {
            const file = path.join(root, rel);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        };

        setup(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), 'gauge-env-'));
            write('env/default/gauge.properties', 'gauge_data_dir=testdata/mod4/preprod\n');
            write('env/odp-live/gauge.properties', '# live\ngauge_data_dir=testdata/mod3/live\n');
            write('env/odp-live/other.properties', 'foo=bar\n');
            write('env/no-data-dir/gauge.properties', 'foo=bar\n');
            write('env/expanded/gauge.properties', 'gauge_data_dir=${BASE}/data\n');
            write('env/nested/sub/gauge.properties', 'gauge_data_dir=testdata/nested\n');
        });

        teardown(() => fs.rmSync(root, { recursive: true, force: true }));

        test('should return the data dir of the selected environment', () => {
            assert.strictEqual(resolveGaugeDataDir(root, ['odp-live']), 'testdata/mod3/live');
        });

        test('should use the first environment that defines a data dir', () => {
            assert.strictEqual(resolveGaugeDataDir(root, ['no-data-dir', ' odp-live ']), 'testdata/mod3/live');
        });

        test('should find properties in sub directories like gauge does', () => {
            assert.strictEqual(resolveGaugeDataDir(root, ['nested']), 'testdata/nested');
        });

        test('should leave the default environment to gauge', () => {
            assert.strictEqual(resolveGaugeDataDir(root, ['default']), undefined);
            assert.strictEqual(resolveGaugeDataDir(root, []), undefined);
            assert.strictEqual(resolveGaugeDataDir(root, undefined), undefined);
        });

        test('should ignore environments without data dir, missing environments and ${} values', () => {
            assert.strictEqual(resolveGaugeDataDir(root, ['no-data-dir']), undefined);
            assert.strictEqual(resolveGaugeDataDir(root, ['missing']), undefined);
            assert.strictEqual(resolveGaugeDataDir(root, ['expanded']), undefined);
        });
    });
});
