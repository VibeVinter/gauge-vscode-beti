'use strict';

import { Disposable, ExtensionContext } from "vscode";
import { LAST_REPORT_PATH, SELECTED_RUN_CONFIGURATIONS } from "./constants";

export class GaugeState extends Disposable {
    constructor(private context: ExtensionContext) {
        super(() => this.dispose());
    }

    setReportPath(reportPath: string) {
        this.context.workspaceState.update(LAST_REPORT_PATH, reportPath);
    }

    getReportPath(): string {
        return this.context.workspaceState.get(LAST_REPORT_PATH);
    }

    getSelectedRunConfiguration(folderUri: string): string | undefined {
        return this.getSelectedRunConfigurations()[folderUri];
    }

    setSelectedRunConfiguration(folderUri: string, name: string | undefined): Thenable<void> {
        const selections = { ...this.getSelectedRunConfigurations() };
        if (name) selections[folderUri] = name;
        else delete selections[folderUri];
        return this.context.workspaceState.update(SELECTED_RUN_CONFIGURATIONS, selections);
    }

    private getSelectedRunConfigurations(): { [folderUri: string]: string } {
        return this.context.workspaceState.get(SELECTED_RUN_CONFIGURATIONS) || {};
    }
}
