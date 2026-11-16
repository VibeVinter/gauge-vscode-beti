import { DebugConfiguration } from 'vscode';
import { GaugeCommands } from '../constants';

export type GaugeRunOption = {
    env?: string[];
    failed?: boolean;
    'hide-suggestion'?: boolean;
    n?: number;
    parallel?: boolean;
    repeat?: boolean;
    'retry-only'?: string;
    scenario?: string[];
    'simple-console'?: boolean;
    tags?: string;
}

const commonLaunchAttributes = new Set([
    'type',
    'request',
    'name',
    'presentation',
    'preLaunchTask',
    'postDebugTask',
    'internalConsoleOptions',
    'debugServer',
    'serverReadyAction',
    'windows',
    'linux',
    'osx'
]);

const excludeCommonLaunchAtrributes = (object: object): object =>
    Object.entries(object).filter(([key, _]) => !(commonLaunchAttributes.has(key)))
        .reduce((out, [k, v]) => { out[k] = v; return out; }, {});

export const isGaugeRunConfiguration = (config: DebugConfiguration): boolean =>
    !!config && config.type === 'gauge' && config.request === 'test';

export const getGaugeRunConfigurations = (configs: DebugConfiguration[]): DebugConfiguration[] =>
    (configs || []).filter(isGaugeRunConfiguration);

/**
 * Picks the gauge:test launch configuration named `selectedName`.
 * Falls back to the first gauge:test entry if no name is given or no entry with that name exists.
 */
export const selectGaugeRunConfiguration = (
    configs: DebugConfiguration[], selectedName?: string
): DebugConfiguration | undefined => {
    const candidates = getGaugeRunConfigurations(configs);
    return (selectedName && candidates.find(c => c.name === selectedName)) || candidates[0];
}

export const extractGaugeRunOption = (configs: DebugConfiguration[], selectedName?: string): GaugeRunOption => {
    return excludeCommonLaunchAtrributes(selectGaugeRunConfiguration(configs, selectedName) || {});
}

type BuildRunArgs = (spec: string, option: GaugeRunOption) => string[]

const flag = (key: string) => `--${key}`

const buildGaugeArgs: BuildRunArgs = (spec, option) => {
    const args: string[] = [GaugeCommands.Run];

    if (option.failed) return args.concat(flag('failed'));
    if (option.repeat) return args.concat(flag('repeat'));

    args.push(...Object.entries(
        { 'hide-suggestion': true, 'simple-console': !option.parallel, ...option }
    ).map(([k, v]) => {
        if (typeof v === 'boolean') return v ? [flag(k)] : [];
        if (v instanceof Array && v.every(e => typeof e === 'string')) return [flag(k), v.join(',')];
        if (typeof v === 'string' || typeof v === 'number') return [flag(k), `${v}`];
        return [];
    }).reduce((acc, arr) => acc.concat(arr)));

    if (spec) args.push(spec);

    return args;
}

const buildJavaRunArgs = (spec: string, option: GaugeRunOption, prefix: string, additionalFlags: (...keys: string[]) => string) => {
    const {
        failed, repeat, tags, parallel, n, env, ...rest
    } = {
        'hide-suggestion': true, 'simple-console': true, ...option
    };
    const p = (str: string) => `${prefix}${str}`;
    const args = [] as string[];
    if (failed) return args.concat(p(additionalFlags('failed')));
    if (repeat) return args.concat(p(additionalFlags('repeat')));
    if (parallel) {
        args.push(p('inParallel=true'));
        if (n) args.push(p(`nodes=${n}`));
    }
    if (tags) args.push(p(`tags=${tags}`));
    if (env) args.push(p(`env=${env.join(',')}`));

    const flags = Object.entries(rest).filter(([, v]) => typeof v === 'boolean' && v).map(([k,]) => k);
    if (flags && 0 < flags.length) args.push(p(additionalFlags(...flags)));

    if (spec) args.push(p(`specsDir=${spec}`));
    return args;
}

const buildGradleArgs: BuildRunArgs = (spec, option) => {
    const additionalFlags = (...keys: string[]) => `additionalFlags=${keys.map(flag).join(' ')}`;
    return ['clean', 'gauge', ...buildJavaRunArgs(spec, option, '-P', additionalFlags)];
}

const buildMavenArgs: BuildRunArgs = (spec, option): string[] => {
    const flags = (...keys: string[]) => `flags=${keys.map(flag).join(',')}`;
    return ['-q', 'clean', 'compile', 'test-compile', 'gauge:execute',
        ...buildJavaRunArgs(spec, option, '-D', flags)];
}

export const buildRunArgs = {
    forGauge: buildGaugeArgs,
    forGradle: buildGradleArgs,
    forMaven: buildMavenArgs,
}
