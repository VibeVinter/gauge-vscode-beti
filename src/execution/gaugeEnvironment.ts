'use strict';

import * as fs from 'fs';
import * as path from 'path';

export const GAUGE_DATA_DIR = 'gauge_data_dir';
const DEFAULT_ENV = 'default';
const ENV_DIR = 'env';

/** Minimal parser for Java style .properties files (key=value, key:value or key value; # and ! comments). */
export const parseProperties = (text: string): { [key: string]: string } => {
    const result: { [key: string]: string } = {};
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) continue;
        const match = /^([^=:\s]+)\s*[=:\s]\s*(.*)$/.exec(line);
        if (match) result[match[1]] = match[2].trim();
        else result[line] = '';
    }
    return result;
};

const propertiesFiles = (dir: string): string[] => {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((e) => {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) return propertiesFiles(p);
            return e.isFile() && path.extname(e.name) === '.properties' ? [p] : [];
        });
};

/**
 * Returns the `gauge_data_dir` that `gauge run --env <envNames>` would use, if one of the given
 * (non-default) environments defines it. Returns undefined to keep Gauge's own default handling,
 * e.g. when no environment is given, the environment does not define it or the value uses ${...}.
 */
export const resolveGaugeDataDir = (projectRoot: string, envNames: string[] | undefined): string | undefined => {
    for (const envName of (envNames || []).map((e) => e.trim())) {
        if (!envName || envName === DEFAULT_ENV) continue;
        for (const file of propertiesFiles(path.join(projectRoot, ENV_DIR, envName))) {
            let value: string | undefined;
            try {
                value = parseProperties(fs.readFileSync(file, 'utf8'))[GAUGE_DATA_DIR];
            } catch {
                continue;
            }
            if (value && !value.includes('${')) return value;
        }
    }
    return undefined;
};
