'use strict';

import {
    commands, DebugConfiguration, Disposable, Event, EventEmitter, QuickPickItem, StatusBarAlignment,
    StatusBarItem, window, workspace, WorkspaceFolder
} from 'vscode';
import { GaugeVSCodeCommands } from '../constants';
import { GaugeState } from '../gaugeState';
import { getGaugeRunConfigurations, selectGaugeRunConfiguration } from './runArgs';

interface RunConfigurationItem extends QuickPickItem {
    configurationName?: string;
}

const launchConfigurations = (folder: WorkspaceFolder): DebugConfiguration[] =>
    workspace.getConfiguration('launch', folder).get<DebugConfiguration[]>('configurations') || [];

const describe = (config: DebugConfiguration): string => {
    const parts: string[] = [];
    if (Array.isArray(config.env) && config.env.length > 0) parts.push(`env: ${config.env.join(',')}`);
    if (config.tags) parts.push(`tags: ${config.tags}`);
    return parts.join('  ');
};

/**
 * Lets the user choose which `"type": "gauge", "request": "test"` entry of launch.json is used
 * for runs started from CodeLens, commands and the spec explorer. The choice is stored per
 * workspace folder in the workspace state, so launch.json itself is never modified.
 * Without a (valid) choice, the first gauge:test entry is used, as before.
 */
export class RunConfigurationSelector extends Disposable {
    private readonly statusBarItem: StatusBarItem;
    private readonly _disposables: Disposable[] = [];
    private readonly _onDidChange = new EventEmitter<void>();

    /** Fires when the chosen configuration or launch.json changed. */
    public readonly onDidChange: Event<void> = this._onDidChange.event;

    constructor(private state: GaugeState) {
        super(() => this.dispose());
        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 3);
        this.statusBarItem.command = GaugeVSCodeCommands.SelectRunConfiguration;
        this._disposables.push(
            this.statusBarItem,
            this._onDidChange,
            commands.registerCommand(GaugeVSCodeCommands.SelectRunConfiguration, () => this.select()),
            workspace.onDidChangeConfiguration((e) => {
                if (!e.affectsConfiguration('launch')) return;
                this.refresh();
                this._onDidChange.fire();
            }),
            workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
            window.onDidChangeActiveTextEditor(() => this.refresh())
        );
        this.refresh();
    }

    /** Name of the chosen configuration for the folder, or undefined to use the first gauge:test entry. */
    public getSelectedName(folder: WorkspaceFolder | undefined): string | undefined {
        if (!folder) return undefined;
        return this.state.getSelectedRunConfiguration(folder.uri.toString());
    }

    /** The gauge:test configuration runs of this folder use: the chosen one, else the first. */
    public getActiveConfiguration(folder: WorkspaceFolder | undefined): DebugConfiguration | undefined {
        if (!folder) return undefined;
        return selectGaugeRunConfiguration(launchConfigurations(folder), this.getSelectedName(folder));
    }

    public dispose() {
        this._disposables.forEach((d) => d.dispose());
    }

    private async select(): Promise<void> {
        const folder = await this.pickFolder();
        if (!folder) return;
        const configs = getGaugeRunConfigurations(launchConfigurations(folder)).filter((c) => !!c.name);
        if (configs.length === 0) {
            window.showInformationMessage(
                `No launch configuration with "type": "gauge" and "request": "test" found in ${folder.name}.`);
            return;
        }
        const selected = this.getSelectedName(folder);
        const active = selectGaugeRunConfiguration(configs, selected);
        const items: RunConfigurationItem[] = configs.map((c) => ({
            label: `${c === active ? '$(check)' : '$(blank)'} ${c.name}`,
            description: describe(c),
            configurationName: c.name
        }));
        if (selected) {
            items.push({
                label: '$(discard) Reset',
                description: 'use the first gauge:test entry in launch.json',
                configurationName: undefined
            });
        }
        const choice = await window.showQuickPick(items, {
            placeHolder: `Gauge run configuration for ${folder.name}`
        });
        if (!choice) return;
        await this.state.setSelectedRunConfiguration(folder.uri.toString(), choice.configurationName);
        this.refresh();
        this._onDidChange.fire();
    }

    private async pickFolder(): Promise<WorkspaceFolder | undefined> {
        const current = this.currentFolder();
        if (current) return current;
        return window.showWorkspaceFolderPick({ placeHolder: 'Select the workspace folder' });
    }

    private currentFolder(): WorkspaceFolder | undefined {
        const editor = window.activeTextEditor;
        const folder = editor && workspace.getWorkspaceFolder(editor.document.uri);
        if (folder) return folder;
        const folders = workspace.workspaceFolders;
        return folders && folders.length === 1 ? folders[0] : undefined;
    }

    private refresh(): void {
        const folder = this.currentFolder();
        const configs = folder ? getGaugeRunConfigurations(launchConfigurations(folder)) : [];
        if (!folder || configs.length === 0) {
            this.statusBarItem.hide();
            return;
        }
        const active = selectGaugeRunConfiguration(configs, this.getSelectedName(folder));
        const name = active.name || '(unnamed)';
        const details = describe(active);
        this.statusBarItem.text = `$(beaker) Gauge: ${name}`;
        this.statusBarItem.tooltip = `Gauge run configuration (launch.json): ${name}`
            + (details ? `\n${details}` : '')
            + '\nClick to change';
        this.statusBarItem.show();
    }
}
