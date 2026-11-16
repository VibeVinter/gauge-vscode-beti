import * as assert from 'assert';
import { buildRunArgs, extractGaugeRunOption, getGaugeRunConfigurations } from '../../src/execution/runArgs';

suite('Gauge Run Args Tests', () => {
    suite('buildRunArgs.forGauge', () => {
        test('should ignore other args when failed flag is set', () => {
            assert.strictEqual(
                buildRunArgs.forGauge('my.spec:123', { failed: true, tags: 'should be ignored' }).join(' '),
                'run --failed');
        });

        test('should ignore other args when repeat flag is set', () => {
            assert.strictEqual(
                buildRunArgs.forGauge('my.spec:123', { repeat: true, tags: 'should be ignored' }).join(' '),
                'run --repeat');
        });

        test('should be formatted', () => {
            assert.strictEqual(
                buildRunArgs.forGauge('my.spec:123', {
                    tags: 'foo bar',
                    n: 3,
                    env: ['a', 'b', 'c'],
                    parallel: true,
                    // following should be ignored
                    failed: null,
                    repeat: false,
                    'retry-only': null
                }).join(' '),
                'run --hide-suggestion --tags foo bar --n 3 --env a,b,c --parallel my.spec:123');
        });

        test('should not contain simple-console flag when parallel flag is set', () => {
            assert.strictEqual(
                buildRunArgs.forGauge('my.spec:123', { parallel: true }).join(' '),
                'run --hide-suggestion --parallel my.spec:123');
        });

        test('should be unsettable', () => {
            assert.strictEqual(
                buildRunArgs.forGauge(null, { 'hide-suggestion': false, 'simple-console': false }).join(' '),
                'run');
        });
    });

    suite('buildRunArgs.forGradle', () => {
        test('should ignore other args when failed flag is set', () => {
            assert.strictEqual(
                buildRunArgs.forGradle('my.spec:123', { failed: true }).join(' '),
                'clean gauge -PadditionalFlags=--failed');
        });

        test('should ignore other args when repeat flag is set', () => {
            assert.strictEqual(
                buildRunArgs.forGradle('my.spec:123', { repeat: true }).join(' '),
                'clean gauge -PadditionalFlags=--repeat');
        });

        test('should be formatted', () => {
            assert.strictEqual(
                buildRunArgs.forGradle('my.spec:123', {
                    tags: 'foo bar',
                    env: ['a', 'b', 'c'],
                    parallel: true,
                    n: 3,
                    // following should be ignored
                    failed: null,
                    repeat: false,
                    'retry-only': null
                }).join(' '),
                'clean gauge -PinParallel=true -Pnodes=3 -Ptags=foo bar -Penv=a,b,c -PadditionalFlags=--hide-suggestion --simple-console -PspecsDir=my.spec:123');
        });

        test('should be unsettable', () => {
            assert.strictEqual(
                buildRunArgs.forGradle(null, { 'hide-suggestion': false, 'simple-console': false }).join(' '),
                'clean gauge');
        });
    });

    suite('buildRunArgs.forMaven', () => {
        test('should ignore other args when failed flag is set', () => {
            assert.strictEqual(
                buildRunArgs.forMaven('my.spec:123', { failed: true }).join(' '),
                '-q clean compile test-compile gauge:execute -Dflags=--failed');
        });

        test('should ignore other args when repeat flag is set', () => {
            assert.strictEqual(
                buildRunArgs.forMaven('my.spec:123', { repeat: true }).join(' '),
                '-q clean compile test-compile gauge:execute -Dflags=--repeat');
        });

        test('should be formatted', () => {
            assert.strictEqual(
                buildRunArgs.forMaven('my.spec:123', {
                    tags: 'foo bar',
                    env: ['a', 'b', 'c'],
                    parallel: true,
                    n: 3,
                    // following should be ignored
                    failed: null,
                    repeat: false,
                    'retry-only': null
                }).join(' '),
                '-q clean compile test-compile gauge:execute -DinParallel=true -Dnodes=3 -Dtags=foo bar -Denv=a,b,c -Dflags=--hide-suggestion,--simple-console -DspecsDir=my.spec:123');
        });

        test('should be unsettable', () => {
            assert.strictEqual(
                buildRunArgs.forMaven(null, { 'hide-suggestion': false, 'simple-console': false }).join(' '),
                '-q clean compile test-compile gauge:execute');
        });

    });

    suite('extractGaugeRunOption', () => {
        test('should pick the first gauge:test entry and remove the common launch attributes', () => {
            const configs = [
                { type: 'foo', name: '1', request: 'launch', tags: 'fail' },
                { type: 'bar', name: '2', request: 'test', tags: 'fail' },
                { type: 'gauge', name: '3', request: 'attach', tags: 'fail' },
                { type: 'gauge', name: '4', request: 'test', tags: 'hit', unknown: 'attributes are also available' },
                { type: 'gauge', name: '5', request: 'test', tags: 'fail' }
            ]
            assert.deepStrictEqual(extractGaugeRunOption(configs), { tags: 'hit', unknown: 'attributes are also available' });
        });

        test('should return empty object when no gauge:test entry is found', () => {
            const configs = [
                { type: 'foo', name: '1', request: 'launch' },
                { type: 'bar', name: '2', request: 'test' },
                { type: 'gauge', name: '3', request: 'attach' },
            ]
            assert.deepStrictEqual(extractGaugeRunOption(configs), {});
        });

        test('should return empty object for null', () => {
            assert.deepStrictEqual(extractGaugeRunOption(null), {});
        });

        const selectableConfigs = [
            { type: 'java', name: 'preprod', request: 'launch', env: ['fail'] },
            { type: 'gauge', name: 'preprod', request: 'attach', env: ['fail'] },
            { type: 'gauge', name: 'preprod', request: 'test', env: ['preprod'] },
            { type: 'gauge', name: 'prod', request: 'test', env: ['prod'], tags: 'smoke' }
        ];

        test('should pick the gauge:test entry with the selected name', () => {
            assert.deepStrictEqual(extractGaugeRunOption(selectableConfigs, 'prod'), { env: ['prod'], tags: 'smoke' });
        });

        test('should fall back to the first gauge:test entry when the selected name does not exist', () => {
            assert.deepStrictEqual(extractGaugeRunOption(selectableConfigs, 'removed'), { env: ['preprod'] });
        });

        test('should fall back to the first gauge:test entry when no name is selected', () => {
            assert.deepStrictEqual(extractGaugeRunOption(selectableConfigs, undefined), { env: ['preprod'] });
        });

        test('should not select a non gauge:test entry by name', () => {
            const configs = [
                { type: 'gauge', name: 'first', request: 'test', env: ['first'] },
                { type: 'java', name: 'other', request: 'launch', env: ['fail'] }
            ];
            assert.deepStrictEqual(extractGaugeRunOption(configs, 'other'), { env: ['first'] });
        });
    });

    suite('getGaugeRunConfigurations', () => {
        const selectableConfigsForList = [
            { type: 'java', name: 'x', request: 'launch' },
            { type: 'gauge', name: 'b', request: 'test' },
            { type: 'gauge', name: 'y', request: 'attach' },
            { type: 'gauge', name: 'a', request: 'test' }
        ];

        test('should only return gauge:test entries in launch.json order', () => {
            assert.deepStrictEqual(getGaugeRunConfigurations(selectableConfigsForList).map(c => c.name), ['b', 'a']);
        });

        test('should return empty array for null', () => {
            assert.deepStrictEqual(getGaugeRunConfigurations(null), []);
        });
    });
});