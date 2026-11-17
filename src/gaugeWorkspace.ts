'use strict';

import { platform } from 'os';
import * as path from 'path';
import {
    CancellationTokenSource, commands, Disposable, OutputChannel, ProgressLocation, Uri,
    window, workspace, WorkspaceConfiguration, WorkspaceFoldersChangeEvent
} from "vscode";
import { DynamicFeature, LanguageClient, LanguageClientOptions, RevealOutputChannelOn, ServerOptions } from "vscode-languageclient/node";
import { CLI } from './cli';
import GaugeConfig from './config/gaugeConfig';
import { GaugeJavaProjectConfig } from './config/gaugeProjectConfig';
import { GaugeCommandContext, GaugeRunners, setCommandContext } from "./constants";
import { GaugeExecutor } from "./execution/gaugeExecutor";
import { RunConfigurationSelector } from "./execution/runConfigurationSelector";
import { GAUGE_DATA_DIR, resolveGaugeDataDir } from "./execution/gaugeEnvironment";
import { SpecNodeProvider } from "./explorer/specExplorer";
import { SpecificationProvider } from './file/specificationFileProvider';
import { GaugeClients as GaugeProjectClientMap } from './gaugeClients';
import { GaugeState } from "./gaugeState";
import { GaugeWorkspaceFeature } from "./gaugeWorkspace.proposed";
import { GaugeProject } from './project/gaugeProject';
import { MavenProject } from './project/mavenProject';
import { ProjectFactory } from './project/projectFactory';
import { getActiveGaugeDocument, hasActiveGaugeDocument } from './util';

const DEBUG_LOG_LEVEL_CONFIG = 'enableDebugLogs';
const GAUGE_LAUNCH_CONFIG = 'gauge.launch';
const GAUGE_CODELENS_CONFIG = 'gauge.codeLenses';
const REFERENCE_CONFIG = 'reference';

export class GaugeWorkspace extends Disposable {
    private readonly _fileProvider: SpecificationProvider;
    private _executor: GaugeExecutor;
    private _runConfigurationSelector: RunConfigurationSelector;
    private _languageServerDataDirs: Map<string, string | undefined> = new Map();
    private _projectEnvs: Map<string, NodeJS.ProcessEnv> = new Map();
    private _languageServerRestart: Promise<void> = Promise.resolve();
    private _clientsMap: GaugeProjectClientMap;
    private _clientLanguageMap: Map<string, string> = new Map();
    private _outputChannel: OutputChannel = window.createOutputChannel('gauge');
    private _launchConfig: WorkspaceConfiguration;
    private _codeLensConfig: WorkspaceConfiguration;
    private _disposable: Disposable;
    private _specNodeProvider: SpecNodeProvider;

    constructor(private state: GaugeState, private cli: CLI, clientsMap: GaugeProjectClientMap) {
        super(() => this.dispose());

        this._clientsMap = clientsMap
        this._runConfigurationSelector = new RunConfigurationSelector(state);
        this._executor = new GaugeExecutor(this, cli);

        if (workspace.workspaceFolders) {
            workspace.workspaceFolders.forEach(async (folder) => {
                await this.startServerFor(folder.uri.fsPath);
            });
        }

        if (hasActiveGaugeDocument(window.activeTextEditor))
            this.startServerForSpecFile(window.activeTextEditor.document.uri.fsPath);

        setCommandContext(GaugeCommandContext.MultiProject, this._clientsMap.size > 1);

        workspace.onDidChangeWorkspaceFolders(async (event) => {
            if (event.added) await this.onFolderAddition(event);
            if (event.removed) this.onFolderDeletion(event);
            setCommandContext(GaugeCommandContext.MultiProject, this._clientsMap.size > 1);
        });
        this._fileProvider = new SpecificationProvider(this);
        this._specNodeProvider = new SpecNodeProvider(this);
        this._disposable = Disposable.from(
            this._specNodeProvider,
            this._executor,
            this._runConfigurationSelector,
            this._fileProvider,
            this.onConfigurationChange(),
            this.onEditorChange(),
            this._runConfigurationSelector.onDidChange(() => this.onRunConfigurationChange())
        );
    }

    /**
     * The language server has no --env option and always loads env/default. Pass the gauge_data_dir
     * of the selected run configuration's environment instead, so tables (CodeLens, diagnostics)
     * resolve like in `gauge run --env <env>`. Gauge keeps variables that are already set.
     */
    private languageServerDataDir(projectRoot: string): string | undefined {
        if (process.env[GAUGE_DATA_DIR]) return undefined;
        const folder = workspace.getWorkspaceFolder(Uri.file(projectRoot));
        const config = this._runConfigurationSelector.getActiveConfiguration(folder);
        return resolveGaugeDataDir(projectRoot, config && Array.isArray(config.env) ? config.env : undefined);
    }

    private onRunConfigurationChange() {
        // Serialize restarts, so quick successive changes cannot overlap.
        this._languageServerRestart = this._languageServerRestart
            .then(() => this.restartLanguageServersWithChangedDataDir())
            .catch((e) => this._outputChannel.appendLine(`Restarting the language server failed: ${e?.message || e}`));
    }

    /**
     * Restarts the language server of every project whose gauge_data_dir changed with the selected
     * run configuration. The server reads the variable only on start, so it has to be restarted.
     */
    private async restartLanguageServersWithChangedDataDir(): Promise<void> {
        let restarted = false;
        for (const [root, started] of Array.from(this._languageServerDataDirs)) {
            if (!this._clientsMap.has(root)) continue;
            const wanted = this.languageServerDataDir(root);
            if (wanted === started) continue;
            await window.withProgress({
                location: ProgressLocation.Window,
                title: `Gauge: restarting language server (${GAUGE_DATA_DIR}=${wanted || 'from env/default'})`
            }, async () => {
                const client = this._clientsMap.get(root).client;
                this._clientsMap.delete(root);
                try {
                    await client.stop();
                } catch (e) {
                    this._outputChannel.appendLine(`Stopping the language server failed: ${e?.message || e}`);
                }
                await this.startServerFor(root);
            });
            restarted = true;
        }
        if (restarted) this._specNodeProvider.changeClient(this.getDefaultFolder());
    }

    /** Project env (e.g. the Maven classpath) is computed once per project, not again on every restart. */
    private projectEnvs(project: GaugeProject): NodeJS.ProcessEnv {
        if (!this._projectEnvs.has(project.root())) {
            const envs = project.envs(this.cli);
            if (!envs) return {};
            this._projectEnvs.set(project.root(), envs);
        }
        return this._projectEnvs.get(project.root());
    }

    private onEditorChange(): Disposable {
        return window.onDidChangeActiveTextEditor(async (editor) => {
            getActiveGaugeDocument(window.activeTextEditor).then(async (p) => {
                if (p) await this.startServerForSpecFile(p);
            });
        });
    }

    private async startServerForSpecFile(file: string) {
        let project = ProjectFactory.getGaugeRootFromFilePath(file);
        await this.startServerFor(project);
    }

    setReportPath(reportPath: string) {
        this.state.setReportPath(reportPath.trim());
    }

    getReportPath() {
        return this.state.getReportPath();
    }

    getGaugeExecutor(): GaugeExecutor {
        return this._executor;
    }

    getRunConfigurationSelector(): RunConfigurationSelector {
        return this._runConfigurationSelector;
    }

    getClientsMap(): GaugeProjectClientMap {
        return this._clientsMap;
    }

    getClientLanguageMap(): Map<string, string> {
        return this._clientLanguageMap;
    }

    getDefaultFolder() {
        let projects: any = [];
        this._clientsMap.forEach((v, k) => projects.push(k));
        return projects.sort((a: any, b: any) => a > b)[0];
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    showProjectOptions(onChange: Function) {
        let projectItems = [];
        this._clientsMap.forEach((v, k) => projectItems.push({ label: path.basename(k), description: k }));
        let options = { canPickMany: false, placeHolder: "Choose a project" };
        return window.showQuickPick(projectItems, options).then((selected: any) => {
            if (selected) {
                return onChange(selected.description);
            }
        }, (err) => {
            window.showErrorMessage('Unable to select project.', err);
        });
    }

    private async onFolderAddition(event: WorkspaceFoldersChangeEvent) {
        for (let folder of event.added) {
            if (!this._clientsMap.has(folder.uri.fsPath)) {
                await this.startServerFor(folder.uri.fsPath);
            }
        }
    }

    private onFolderDeletion(event: WorkspaceFoldersChangeEvent) {
        for (let folder of event.removed) {
            if (!this._clientsMap.has(folder.uri.fsPath)) return;
            let client = this._clientsMap.get(folder.uri.fsPath).client;
            this._clientsMap.delete(folder.uri.fsPath);
            this._projectEnvs.delete(folder.uri.fsPath);
            client.stop();
        }
        this._specNodeProvider.changeClient(this.getDefaultFolder());
    }

    private async startServerFor(folder: string): Promise<any> {
        if (!ProjectFactory.isGaugeProject(folder)) return;
        let project = ProjectFactory.get(folder);
        if (this._clientsMap.has(project.root())) return;
        process.env.GAUGE_IGNORE_RUNNER_BUILD_FAILURES = "true";
        let cmd = this.cli.gaugeCommand();
        let serverOptions: ServerOptions = {
            command: cmd.command,
            args: cmd.argsForSpawnType(["daemon", "--lsp", "--dir", project.root()]),
            options: {
                env: { ...process.env, ...this.projectEnvs(project) },
                ...cmd.defaultSpawnOptions,
            },
        };

        this._launchConfig = workspace.getConfiguration(GAUGE_LAUNCH_CONFIG);
        if (this._launchConfig.get(DEBUG_LOG_LEVEL_CONFIG)) {
            serverOptions.args.push("-l");
            serverOptions.args.push("debug");
        }
        const dataDir = this.languageServerDataDir(project.root());
        if (dataDir) {
            serverOptions.options.env[GAUGE_DATA_DIR] = dataDir;
            this._outputChannel.appendLine(`Starting language server with ${GAUGE_DATA_DIR}=${dataDir}`);
        }
        this._languageServerDataDirs.set(project.root(), dataDir);
        this._codeLensConfig = workspace.getConfiguration(GAUGE_CODELENS_CONFIG);
        if (this._codeLensConfig.has(REFERENCE_CONFIG) && !this._codeLensConfig.get(REFERENCE_CONFIG)) {
            serverOptions.options.env.gauge_lsp_reference_codelens = 'false';
        }
        let clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file', language: 'gauge', pattern: `${project.root()}/**/*` }],
            diagnosticCollectionName: 'gauge',
            outputChannel: this._outputChannel,
            revealOutputChannelOn: RevealOutputChannelOn.Never,
            synchronize: {
                configurationSection: 'gauge'
            },
        };
        clientOptions.workspaceFolder = workspace.getWorkspaceFolder(Uri.file(folder));
        let languageClient = new LanguageClient('gauge', 'Gauge', serverOptions, clientOptions);
        this._clientsMap.set(project.root(), { project: project, client: languageClient });
        await this.installRunnerFor(project);
        this.generateJavaConfig(project);
        this.registerDynamicFeatures(languageClient);
        await languageClient.start();
        this.setLanguageId(languageClient, project.root());
    }

    private generateJavaConfig(project: GaugeProject) {
        if (project.isProjectLanguage(GaugeRunners.Java) && this.cli.isPluginInstalled(GaugeRunners.Java)) {
            if (!(project instanceof MavenProject)) {
                new GaugeJavaProjectConfig(project.root(),
                    this.cli.getGaugePluginVersion(GaugeRunners.Java), new GaugeConfig(platform())).generate();
            }
            process.env.SHOULD_BUILD_PROJECT = "false";
        }
    }

    private async installRunnerFor(project: GaugeProject): Promise<any> {
        const language = project.language();
        if (this.cli.isPluginInstalled(language)) return;
        let message = `The project ${path.basename(project.root())} requires gauge ${language} to be installed. ` +
            "Would you like to install it?";
        let action = await window.showErrorMessage(message, { modal: true }, "Yes", "No");
        if (action === "Yes") {
            return await this.cli.installGaugeRunner(language);
        }
        return Promise.resolve();
    }

    private registerDynamicFeatures(languageClient: LanguageClient) {
        let result: Array<(DynamicFeature<any>)> = [];
        result.push(new GaugeWorkspaceFeature(languageClient));
        languageClient.registerFeatures(result);
    }

    private setLanguageId(languageClient: LanguageClient, projectRoot: string) {
        languageClient.sendRequest("gauge/getRunnerLanguage", new CancellationTokenSource().token).then(
            (language: string) => {
                this._clientLanguageMap.set(projectRoot, language);
            }
        );

    }

    private onConfigurationChange() {
        return workspace.onDidChangeConfiguration((params) => {
            let newConfig = workspace.getConfiguration(GAUGE_LAUNCH_CONFIG);
            if (this._launchConfig.get(DEBUG_LOG_LEVEL_CONFIG) !== newConfig.get(DEBUG_LOG_LEVEL_CONFIG)) {
                let msg = 'Gauge Language Server configuration changed, please restart VS Code.';
                let action = 'Restart Now';
                this._launchConfig = newConfig;
                window.showWarningMessage(msg, action).then((selection) => {
                    if (action === selection) {
                        commands.executeCommand('workbench.action.reloadWindow');
                    }
                });
            }
        });
    }
}
