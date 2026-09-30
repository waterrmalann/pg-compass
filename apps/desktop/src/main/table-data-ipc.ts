import path from "node:path";
import { dialog, BrowserWindow } from "electron";
import { TableDataChannels } from "../shared/constants/ipc-channels";
import type { TableDataFailure } from "../shared/types/table-data";
import {
  cancelQuery,
  executeQuery,
  getQueryColumns,
  getRows,
} from "./table-data-rows";
import { QueryDslFailure } from "./query-dsl/prepare";
import {
  getConstraints,
  getIndexes,
  getStructure,
  getTriggers,
  getTypes,
  toggleTrigger,
} from "./table-data-meta";
import { exportData, sqlDump } from "./table-data-export";
import { importData } from "./table-data-import";
import {
  deleteRows,
  insertRow,
  updateCell,
  updateRow,
} from "./table-data-write";
import { searchForeignKey } from "./table-data-fk";
import {
  validateCancelQueryParams,
  validateDeleteRowsParams,
  validateExecuteQueryParams,
  validateExportDataParams,
  validateGetRowsParams,
  validateImportDataParams,
  validateImportOpenDialogOptions,
  validateInsertRowParams,
  validateSaveDialogOptions,
  validateSearchForeignKeyParams,
  validateSqlDumpParams,
  validateTableMetaParams,
  validateToggleTriggerParams,
  validateUpdateCellParams,
  validateUpdateRowParams,
} from "./ipc-validation";
import {
  approveSavePath,
  consumeApprovedSavePath,
  registerIpcHandler,
} from "./ipc-security";

function resolveTestSaveDialogPath(
  options: Electron.SaveDialogOptions,
): string | null {
  const explicitPath = process.env.PG_COMPASS_TEST_SAVE_DIALOG_PATH?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  const saveDir = process.env.PG_COMPASS_TEST_SAVE_DIALOG_DIR?.trim();
  if (!saveDir) {
    return null;
  }

  const fallbackName = options.defaultPath ?? "export.txt";
  return path.resolve(saveDir, path.basename(fallbackName));
}

function resolveTestOpenDialogPath(): string | null {
  return process.env.PG_COMPASS_TEST_OPEN_DIALOG_PATH?.trim() || null;
}

/**
 * Failure envelope for Data-tab operations that accept query DSL. Keeps the
 * plain `error` string for existing callers and adds a structured reason.
 */
function toDataQueryFailure(err: unknown): {
  success: false;
  error: string;
  failure: TableDataFailure;
} {
  if (err instanceof QueryDslFailure) {
    return {
      success: false,
      error: err.message,
      failure: { kind: "query-dsl", errors: err.errors },
    };
  }
  const message = (err as Error).message;
  return {
    success: false,
    error: message,
    failure: { kind: "database", message },
  };
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerTableDataHandlers(): void {
  registerIpcHandler(
    TableDataChannels.GET_ROWS,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateGetRowsParams(rawParams);
        const data = await getRows(params);
        return { success: true, data };
      } catch (err) {
        return toDataQueryFailure(err);
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.GET_QUERY_COLUMNS,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateTableMetaParams(rawParams);
        const data = await getQueryColumns(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.GET_STRUCTURE,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateTableMetaParams(rawParams);
        const data = await getStructure(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.GET_INDEXES,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateTableMetaParams(rawParams);
        const data = await getIndexes(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.GET_CONSTRAINTS,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateTableMetaParams(rawParams);
        const data = await getConstraints(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.GET_TRIGGERS,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateTableMetaParams(rawParams);
        const data = await getTriggers(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.GET_TYPES,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateTableMetaParams(rawParams);
        const data = await getTypes(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.TOGGLE_TRIGGER,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateToggleTriggerParams(rawParams);
        const data = await toggleTrigger(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.EXECUTE_QUERY,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateExecuteQueryParams(rawParams);
        const data = await executeQuery(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.CANCEL_QUERY,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateCancelQueryParams(rawParams);
        const status = await cancelQuery(params.connectionId, params.queryId);
        return { success: true, data: { status } };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.SHOW_SAVE_DIALOG,
    async (event, rawOptions: unknown) => {
      try {
        const options = validateSaveDialogOptions(rawOptions);
        const { purpose, ...dialogOptions } = options;
        const testFilePath = resolveTestSaveDialogPath(dialogOptions);
        if (testFilePath) {
          return {
            success: true,
            data: approveSavePath(event, testFilePath, purpose),
          };
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        const result = win
          ? await dialog.showSaveDialog(win, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);
        if (result.canceled || !result.filePath)
          return { success: true, data: null };
        return {
          success: true,
          data: approveSavePath(event, result.filePath, purpose),
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.SHOW_OPEN_DIALOG,
    async (event, rawOptions: unknown) => {
      try {
        const options = validateImportOpenDialogOptions(rawOptions);
        const { purpose, ...dialogOptions } = options;
        const testFilePath = resolveTestOpenDialogPath();
        if (testFilePath) {
          return {
            success: true,
            data: approveSavePath(event, testFilePath, purpose),
          };
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        const openOptions: Electron.OpenDialogOptions = {
          ...dialogOptions,
          properties: ["openFile"],
        };
        const result = win
          ? await dialog.showOpenDialog(win, openOptions)
          : await dialog.showOpenDialog(openOptions);
        if (result.canceled || result.filePaths.length === 0)
          return { success: true, data: null };
        return {
          success: true,
          data: approveSavePath(event, result.filePaths[0]!, purpose),
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.IMPORT_DATA,
    async (event, rawParams: unknown) => {
      try {
        const params = validateImportDataParams(rawParams);
        const filePath = consumeApprovedSavePath(
          event,
          params.filePath,
          "import",
        );
        const data = await importData({ ...params, filePath }, event.sender);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.INSERT_ROW,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateInsertRowParams(rawParams);
        const data = await insertRow(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.EXPORT_DATA,
    async (event, rawParams: unknown) => {
      try {
        const params = validateExportDataParams(rawParams);
        const filePath = consumeApprovedSavePath(
          event,
          params.filePath,
          "export",
        );
        const data = await exportData({ ...params, filePath }, event.sender);
        return { success: true, data };
      } catch (err) {
        return toDataQueryFailure(err);
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.SQL_DUMP,
    async (event, rawParams: unknown) => {
      try {
        const params = validateSqlDumpParams(rawParams);
        const filePath = consumeApprovedSavePath(
          event,
          params.filePath,
          "sql-dump",
        );
        const data = await sqlDump({ ...params, filePath }, event.sender);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.UPDATE_CELL,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateUpdateCellParams(rawParams);
        const data = await updateCell(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.UPDATE_ROW,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateUpdateRowParams(rawParams);
        const data = await updateRow(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.DELETE_ROWS,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateDeleteRowsParams(rawParams);
        const data = await deleteRows(params);
        return { success: true, data };
      } catch (err) {
        return toDataQueryFailure(err);
      }
    },
  );

  registerIpcHandler(
    TableDataChannels.SEARCH_FK,
    async (_event, rawParams: unknown) => {
      try {
        const params = validateSearchForeignKeyParams(rawParams);
        const data = await searchForeignKey(params);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );
}
