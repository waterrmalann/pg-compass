import type {
  ConnectionFileDialogOptions,
  ConnectionInput,
  SchemaTreeOptions,
} from "../shared/types/connection";
import type {
  AlterRoleInput,
  CloneRoleInput,
  CreateRoleInput,
  CreateTriggerFunctionInput,
  CreateTriggerInput,
  DbAccessInput,
  DbReadonlyGrantInput,
  DropTriggerInput,
  SetTriggerEnabledInput,
  MembershipInput,
  RenameRoleInput,
  SetDbAccessLevelInput,
  TableRestrictionInput,
} from "../shared/types/roles";
import type { AppSettingsPatch } from "../shared/types/settings";
import type {
  DbSyncBackupInput,
  DbSyncCancelInput,
  DbSyncDeleteBackupInput,
  DbSyncEndpoint,
  DbSyncInspectBackupInput,
  DbSyncListDatabasesInput,
  DbSyncMode,
  DbSyncRestoreInput,
  DbSyncRunInput,
  DbSyncSetProdGuardInput,
} from "../shared/types/db-sync";
import type {
  CancelQueryParams,
  DeleteRowsParams,
  ExecuteQueryParams,
  ExportDataParams,
  GetRowsParams,
  ImportDataParams,
  InsertRowParams,
  OpenDialogOptions,
  SaveDialogOptions,
  SearchForeignKeyParams,
  SqlDumpParams,
  TableMetaParams,
  ToggleTriggerParams,
  UpdateCellParams,
  UpdateRowParams,
} from "../shared/types/table-data";
import { serialize } from "node:v8";

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_PATH_LENGTH = 4_096;
const MAX_SQL_LENGTH = 1_000_000;

type UnknownRecord = Record<string, unknown>;

function assertAllowedKeys(
  record: UnknownRecord,
  name: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new TypeError(`${name}.${unknownKey} is not allowed.`);
  }
}

function assertSerializedSize(
  value: unknown,
  name: string,
  maximumBytes = 2_000_000,
): void {
  try {
    if (serialize(value).byteLength > maximumBytes) {
      throw new TypeError(
        `${name} exceeds the ${maximumBytes}-byte payload limit.`,
      );
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("payload limit")) {
      throw error;
    }
    throw new TypeError(`${name} contains an unsupported value.`);
  }
}

function asRecord(value: unknown, name: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }

  return value as UnknownRecord;
}

function asString(
  value: unknown,
  name: string,
  options: { maxLength?: number; allowEmpty?: boolean } = {},
): string {
  const { maxLength = MAX_IDENTIFIER_LENGTH, allowEmpty = false } = options;

  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string.`);
  }
  if (!allowEmpty && value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty.`);
  }
  if (value.length > maxLength) {
    throw new TypeError(`${name} exceeds the ${maxLength}-character limit.`);
  }

  return value;
}

function asOptionalString(
  value: unknown,
  name: string,
  options?: { maxLength?: number; allowEmpty?: boolean },
): string | undefined {
  return value === undefined ? undefined : asString(value, name, options);
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
  return value;
}

function asOptionalBoolean(value: unknown, name: string): boolean | undefined {
  return value === undefined ? undefined : asBoolean(value, name);
}

function asInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

function validateStringArray(
  value: unknown,
  name: string,
  maximumItems = 128,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(
      `${name} must be an array of at most ${maximumItems} strings.`,
    );
  }

  return value.map((item, index) => asString(item, `${name}[${index}]`));
}

function validateDialogFilters(value: unknown, name: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.length > 20) {
    throw new TypeError(`${name} must contain at most 20 filters.`);
  }

  value.forEach((filter, index) => {
    const record = asRecord(filter, `${name}[${index}]`);
    assertAllowedKeys(record, `${name}[${index}]`, ["name", "extensions"]);
    asString(record.name, `${name}[${index}].name`);
    validateStringArray(record.extensions, `${name}[${index}].extensions`, 20);
  });
}

function validateTableIdentity(
  value: unknown,
  name: string,
  extraKeys: readonly string[] = [],
): UnknownRecord {
  const record = asRecord(value, name);
  assertAllowedKeys(record, name, [
    "connectionId",
    "schema",
    "table",
    ...extraKeys,
  ]);
  asString(record.connectionId, `${name}.connectionId`);
  asString(record.schema, `${name}.schema`);
  asString(record.table, `${name}.table`);
  return record;
}

export function validateConnectionId(value: unknown): string {
  return asString(value, "connectionId");
}

export function validateConnectionInput(value: unknown): ConnectionInput {
  assertSerializedSize(value, "connection");
  const input = asRecord(value, "connection");
  assertAllowedKeys(input, "connection", [
    "label",
    "color",
    "favourite",
    "mode",
    "uri",
    "fields",
    "ssl",
    "ssh",
  ]);
  asString(input.label, "connection.label");
  asOptionalString(input.color, "connection.color", { maxLength: 32 });
  asBoolean(input.favourite, "connection.favourite");

  if (input.mode !== "uri" && input.mode !== "fields") {
    throw new TypeError("connection.mode must be either uri or fields.");
  }

  if (input.mode === "uri") {
    asString(input.uri, "connection.uri", { maxLength: 8_192 });
    if (input.fields !== undefined) {
      throw new TypeError(
        "connection.fields is not allowed when connection.mode is uri.",
      );
    }
  } else {
    if (input.uri !== undefined) {
      throw new TypeError(
        "connection.uri is not allowed when connection.mode is fields.",
      );
    }
    const fields = asRecord(input.fields, "connection.fields");
    assertAllowedKeys(fields, "connection.fields", [
      "host",
      "port",
      "database",
      "user",
      "password",
    ]);
    asString(fields.host, "connection.fields.host");
    asInteger(fields.port, "connection.fields.port", 1, 65_535);
    asString(fields.database, "connection.fields.database");
    asString(fields.user, "connection.fields.user");
    asString(fields.password, "connection.fields.password", {
      maxLength: 8_192,
      allowEmpty: true,
    });
  }

  if (input.ssl !== undefined) {
    const ssl = asRecord(input.ssl, "connection.ssl");
    assertAllowedKeys(ssl, "connection.ssl", [
      "enabled",
      "rejectUnauthorized",
      "caSource",
      "ca",
      "cert",
      "key",
    ]);
    asBoolean(ssl.enabled, "connection.ssl.enabled");
    asOptionalBoolean(
      ssl.rejectUnauthorized,
      "connection.ssl.rejectUnauthorized",
    );
    if (
      ssl.caSource !== undefined &&
      ssl.caSource !== "file" &&
      ssl.caSource !== "inline"
    ) {
      throw new TypeError("connection.ssl.caSource is invalid.");
    }
    asOptionalString(ssl.ca, "connection.ssl.ca", {
      maxLength: 1_000_000,
      allowEmpty: true,
    });
    asOptionalString(ssl.cert, "connection.ssl.cert", {
      maxLength: MAX_PATH_LENGTH,
      allowEmpty: true,
    });
    asOptionalString(ssl.key, "connection.ssl.key", {
      maxLength: MAX_PATH_LENGTH,
      allowEmpty: true,
    });
  }

  if (input.ssh !== undefined) {
    const ssh = asRecord(input.ssh, "connection.ssh");
    assertAllowedKeys(ssh, "connection.ssh", [
      "enabled",
      "host",
      "port",
      "user",
      "authMethod",
      "password",
      "privateKeyPath",
      "passphrase",
    ]);
    asBoolean(ssh.enabled, "connection.ssh.enabled");
    asString(ssh.host, "connection.ssh.host");
    asInteger(ssh.port, "connection.ssh.port", 1, 65_535);
    asString(ssh.user, "connection.ssh.user");
    if (ssh.authMethod !== "password" && ssh.authMethod !== "privateKey") {
      throw new TypeError("connection.ssh.authMethod is invalid.");
    }
    asOptionalString(ssh.password, "connection.ssh.password", {
      maxLength: 8_192,
      allowEmpty: true,
    });
    asOptionalString(ssh.privateKeyPath, "connection.ssh.privateKeyPath", {
      maxLength: MAX_PATH_LENGTH,
      allowEmpty: true,
    });
    asOptionalString(ssh.passphrase, "connection.ssh.passphrase", {
      maxLength: 8_192,
      allowEmpty: true,
    });
  }

  return value as ConnectionInput;
}

export function validateSchemaTreeOptions(
  value: unknown,
): SchemaTreeOptions | undefined {
  if (value === undefined) {
    return undefined;
  }

  const options = asRecord(value, "schemaTreeOptions");
  assertAllowedKeys(options, "schemaTreeOptions", ["includeInternalSchemas"]);
  asOptionalBoolean(
    options.includeInternalSchemas,
    "schemaTreeOptions.includeInternalSchemas",
  );
  return value as SchemaTreeOptions;
}

export function validateOpenDialogOptions(
  value: unknown,
): ConnectionFileDialogOptions {
  const options = asRecord(value, "openDialogOptions");
  assertAllowedKeys(options, "openDialogOptions", [
    "title",
    "defaultPath",
    "filters",
  ]);
  asString(options.title, "openDialogOptions.title");
  asOptionalString(options.defaultPath, "openDialogOptions.defaultPath", {
    maxLength: MAX_PATH_LENGTH,
    allowEmpty: true,
  });
  validateDialogFilters(options.filters, "openDialogOptions.filters");
  return value as ConnectionFileDialogOptions;
}

export function validateSettingsPatch(value: unknown): AppSettingsPatch {
  assertSerializedSize(value, "settingsPatch", 100_000);
  const patch = asRecord(value, "settingsPatch");
  assertAllowedKeys(patch, "settingsPatch", [
    "general",
    "appearance",
    "privacy",
  ]);

  if (patch.general !== undefined) {
    const general = asRecord(patch.general, "settingsPatch.general");
    assertAllowedKeys(general, "settingsPatch.general", [
      "readOnlyMode",
      "shellAccess",
      "enableDevTools",
      "hideInternalSchemas",
    ]);
    asOptionalBoolean(
      general.readOnlyMode,
      "settingsPatch.general.readOnlyMode",
    );
    asOptionalBoolean(general.shellAccess, "settingsPatch.general.shellAccess");
    asOptionalBoolean(
      general.enableDevTools,
      "settingsPatch.general.enableDevTools",
    );
    asOptionalBoolean(
      general.hideInternalSchemas,
      "settingsPatch.general.hideInternalSchemas",
    );
  }

  if (patch.appearance !== undefined) {
    const appearance = asRecord(patch.appearance, "settingsPatch.appearance");
    assertAllowedKeys(appearance, "settingsPatch.appearance", [
      "theme",
      "sidebarWidth",
      "density",
    ]);
    if (
      appearance.theme !== undefined &&
      appearance.theme !== "light" &&
      appearance.theme !== "dark" &&
      appearance.theme !== "system"
    ) {
      throw new TypeError("settingsPatch.appearance.theme is invalid.");
    }
    if (
      appearance.density !== undefined &&
      appearance.density !== "compact" &&
      appearance.density !== "comfortable"
    ) {
      throw new TypeError("settingsPatch.appearance.density is invalid.");
    }
    if (appearance.sidebarWidth !== undefined) {
      asInteger(
        appearance.sidebarWidth,
        "settingsPatch.appearance.sidebarWidth",
        240,
        4_096,
      );
    }
  }

  if (patch.privacy !== undefined) {
    const privacy = asRecord(patch.privacy, "settingsPatch.privacy");
    assertAllowedKeys(privacy, "settingsPatch.privacy", ["automaticUpdates"]);
    asOptionalBoolean(
      privacy.automaticUpdates,
      "settingsPatch.privacy.automaticUpdates",
    );
  }

  return value as AppSettingsPatch;
}

export function validateTableMetaParams(value: unknown): TableMetaParams {
  validateTableIdentity(value, "table");
  return value as TableMetaParams;
}

export function validateGetRowsParams(value: unknown): GetRowsParams {
  const params = validateTableIdentity(value, "getRows", [
    "page",
    "pageSize",
    "whereClause",
  ]);
  asInteger(params.page, "getRows.page", 1, 1_000_000);
  asInteger(params.pageSize, "getRows.pageSize", 1, 100);
  asOptionalString(params.whereClause, "getRows.whereClause", {
    maxLength: 100_000,
    allowEmpty: true,
  });
  return value as GetRowsParams;
}

export function validateExecuteQueryParams(value: unknown): ExecuteQueryParams {
  const params = asRecord(value, "executeQuery");
  assertAllowedKeys(params, "executeQuery", [
    "connectionId",
    "queryId",
    "sql",
    "page",
    "pageSize",
  ]);
  asString(params.connectionId, "executeQuery.connectionId");
  asString(params.queryId, "executeQuery.queryId", { maxLength: 128 });
  asString(params.sql, "executeQuery.sql", { maxLength: MAX_SQL_LENGTH });
  asInteger(params.page, "executeQuery.page", 1, 1_000_000);
  asInteger(params.pageSize, "executeQuery.pageSize", 1, 100);
  return value as ExecuteQueryParams;
}

export function validateCancelQueryParams(value: unknown): CancelQueryParams {
  const params = asRecord(value, "cancelQuery");
  assertAllowedKeys(params, "cancelQuery", ["connectionId", "queryId"]);
  asString(params.connectionId, "cancelQuery.connectionId");
  asString(params.queryId, "cancelQuery.queryId", { maxLength: 128 });
  return value as CancelQueryParams;
}

export function validateToggleTriggerParams(
  value: unknown,
): ToggleTriggerParams {
  const params = validateTableIdentity(value, "toggleTrigger", [
    "trigger",
    "enabled",
  ]);
  asString(params.trigger, "toggleTrigger.trigger");
  asBoolean(params.enabled, "toggleTrigger.enabled");
  return value as ToggleTriggerParams;
}

export function validateSaveDialogOptions(value: unknown): SaveDialogOptions {
  const options = asRecord(value, "saveDialogOptions");
  assertAllowedKeys(options, "saveDialogOptions", [
    "purpose",
    "title",
    "defaultPath",
    "filters",
  ]);
  if (options.purpose !== "export" && options.purpose !== "sql-dump") {
    throw new TypeError("saveDialogOptions.purpose is invalid.");
  }
  asOptionalString(options.title, "saveDialogOptions.title");
  asOptionalString(options.defaultPath, "saveDialogOptions.defaultPath", {
    maxLength: MAX_PATH_LENGTH,
    allowEmpty: true,
  });
  validateDialogFilters(options.filters, "saveDialogOptions.filters");
  return value as SaveDialogOptions;
}

export function validateExportDataParams(value: unknown): ExportDataParams {
  const params = asRecord(value, "exportData");
  assertAllowedKeys(params, "exportData", [
    "connectionId",
    "format",
    "filePath",
    "schema",
    "table",
    "sql",
  ]);
  asString(params.connectionId, "exportData.connectionId");
  asString(params.filePath, "exportData.filePath", {
    maxLength: MAX_PATH_LENGTH,
  });
  if (params.format !== "csv" && params.format !== "json") {
    throw new TypeError("exportData.format must be csv or json.");
  }

  const schema = asOptionalString(params.schema, "exportData.schema");
  const table = asOptionalString(params.table, "exportData.table");
  const sql = asOptionalString(params.sql, "exportData.sql", {
    maxLength: MAX_SQL_LENGTH,
  });
  const hasSql = sql !== undefined;
  const hasSchema = schema !== undefined;
  const hasTable = table !== undefined;
  const hasInvalidSource = hasSql
    ? hasSchema || hasTable
    : !hasSchema || !hasTable;
  if (hasInvalidSource) {
    throw new TypeError(
      "exportData must provide either sql or both schema and table.",
    );
  }

  return value as ExportDataParams;
}

export function validateSqlDumpParams(value: unknown): SqlDumpParams {
  const params = validateTableIdentity(value, "sqlDump", ["filePath"]);
  asString(params.filePath, "sqlDump.filePath", {
    maxLength: MAX_PATH_LENGTH,
  });
  return value as SqlDumpParams;
}

export function validateImportOpenDialogOptions(
  value: unknown,
): OpenDialogOptions {
  const options = asRecord(value, "openDialogOptions");
  assertAllowedKeys(options, "openDialogOptions", [
    "purpose",
    "title",
    "defaultPath",
    "filters",
  ]);
  if (options.purpose !== "import") {
    throw new TypeError("openDialogOptions.purpose is invalid.");
  }
  asOptionalString(options.title, "openDialogOptions.title");
  asOptionalString(options.defaultPath, "openDialogOptions.defaultPath", {
    maxLength: MAX_PATH_LENGTH,
    allowEmpty: true,
  });
  validateDialogFilters(options.filters, "openDialogOptions.filters");
  return value as OpenDialogOptions;
}

export function validateImportDataParams(value: unknown): ImportDataParams {
  const params = validateTableIdentity(value, "importData", [
    "filePath",
    "format",
    "operationId",
  ]);
  asString(params.filePath, "importData.filePath", {
    maxLength: MAX_PATH_LENGTH,
  });
  if (params.format !== "csv" && params.format !== "json") {
    throw new TypeError("importData.format must be csv or json.");
  }
  asString(params.operationId, "importData.operationId", { maxLength: 100 });
  return value as ImportDataParams;
}

export function validateInsertRowParams(value: unknown): InsertRowParams {
  assertSerializedSize(value, "insertRow");
  const params = asRecord(value, "insertRow");
  assertAllowedKeys(params, "insertRow", [
    "connectionId",
    "schema",
    "table",
    "changes",
  ]);
  asString(params.connectionId, "insertRow.connectionId");
  asString(params.schema, "insertRow.schema");
  asString(params.table, "insertRow.table");
  if (!Array.isArray(params.changes) || params.changes.length > 1_600) {
    throw new TypeError("insertRow.changes must contain at most 1600 changes.");
  }
  params.changes.forEach((change, index) => {
    const record = asRecord(change, `insertRow.changes[${index}]`);
    assertAllowedKeys(record, `insertRow.changes[${index}]`, [
      "column",
      "pgCast",
      "newValue",
      "setNull",
    ]);
    asString(record.column, `insertRow.changes[${index}].column`);
    asString(record.pgCast, `insertRow.changes[${index}].pgCast`);
    asBoolean(record.setNull, `insertRow.changes[${index}].setNull`);
  });
  return value as InsertRowParams;
}

function validateRowIdentity(
  record: UnknownRecord,
  name: string,
  extraKeys: readonly string[],
): void {
  assertAllowedKeys(record, name, [
    "connectionId",
    "schema",
    "table",
    "pkColumns",
    "pkValues",
    ...extraKeys,
  ]);
  asString(record.connectionId, `${name}.connectionId`);
  asString(record.schema, `${name}.schema`);
  asString(record.table, `${name}.table`);
  const pkColumns = validateStringArray(record.pkColumns, `${name}.pkColumns`);
  if (pkColumns.length === 0) {
    throw new TypeError(`${name}.pkColumns must not be empty.`);
  }
  if (
    !Array.isArray(record.pkValues) ||
    record.pkValues.length !== pkColumns.length
  ) {
    throw new TypeError(`${name}.pkValues must match ${name}.pkColumns.`);
  }
}

export function validateUpdateCellParams(value: unknown): UpdateCellParams {
  assertSerializedSize(value, "updateCell");
  const params = asRecord(value, "updateCell");
  validateRowIdentity(params, "updateCell", [
    "column",
    "pgCast",
    "newValue",
    "setNull",
  ]);
  asString(params.column, "updateCell.column");
  asString(params.pgCast, "updateCell.pgCast");
  asBoolean(params.setNull, "updateCell.setNull");
  // `pg` treats a JS `undefined` value the same as `null` — without this
  // check, a caller bug that drops `newValue` (e.g. a race that reads it
  // before a debounced input finishes) would silently write NULL instead
  // of failing loudly, since `setNull: false` + `newValue: undefined`
  // would otherwise sail through unnoticed.
  if (!params.setNull && params.newValue === undefined) {
    throw new TypeError(
      "updateCell.newValue is required when updateCell.setNull is false.",
    );
  }
  return value as UpdateCellParams;
}

export function validateUpdateRowParams(value: unknown): UpdateRowParams {
  assertSerializedSize(value, "updateRow");
  const params = asRecord(value, "updateRow");
  validateRowIdentity(params, "updateRow", ["changes"]);
  if (
    !Array.isArray(params.changes) ||
    params.changes.length === 0 ||
    params.changes.length > 128
  ) {
    throw new TypeError("updateRow.changes must contain 1 to 128 changes.");
  }
  params.changes.forEach((change, index) => {
    const record = asRecord(change, `updateRow.changes[${index}]`);
    assertAllowedKeys(record, `updateRow.changes[${index}]`, [
      "column",
      "pgCast",
      "newValue",
      "setNull",
    ]);
    asString(record.column, `updateRow.changes[${index}].column`);
    asString(record.pgCast, `updateRow.changes[${index}].pgCast`);
    asBoolean(record.setNull, `updateRow.changes[${index}].setNull`);
    // See the matching check in validateUpdateCellParams: `pg` treats
    // `undefined` the same as `null`, so this must be rejected explicitly
    // rather than silently writing NULL for a value that was never sent.
    if (!record.setNull && record.newValue === undefined) {
      throw new TypeError(
        `updateRow.changes[${index}].newValue is required when setNull is false.`,
      );
    }
  });
  return value as UpdateRowParams;
}

export function validateDeleteRowsParams(value: unknown): DeleteRowsParams {
  const params = validateTableIdentity(value, "deleteRows", ["whereClause"]);
  asOptionalString(params.whereClause, "deleteRows.whereClause", {
    maxLength: 100_000,
    allowEmpty: true,
  });
  return value as DeleteRowsParams;
}

export function validateSearchForeignKeyParams(
  value: unknown,
): SearchForeignKeyParams {
  const params = validateTableIdentity(value, "searchForeignKey", [
    "valueColumn",
    "labelColumn",
    "query",
    "limit",
  ]);
  asString(params.valueColumn, "searchForeignKey.valueColumn");
  if (params.labelColumn !== null) {
    asString(params.labelColumn, "searchForeignKey.labelColumn");
  }
  asString(params.query, "searchForeignKey.query", {
    maxLength: 1_000,
    allowEmpty: true,
  });
  asInteger(params.limit, "searchForeignKey.limit", 1, 200);
  return value as SearchForeignKeyParams;
}

// ---------------------------------------------------------------------------
// Roles / RBAC
// ---------------------------------------------------------------------------

const ROLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function asRoleName(value: unknown, name: string): string {
  const result = asString(value, name, { maxLength: 63 });
  if (!ROLE_NAME_PATTERN.test(result)) {
    throw new TypeError(
      `${name} must be a valid PostgreSQL identifier (letters, digits, underscore; must not start with a digit).`,
    );
  }
  return result;
}

function asDatabaseName(value: unknown, name: string): string {
  const result = asString(value, name, { maxLength: 63 });
  if (!DATABASE_NAME_PATTERN.test(result)) {
    throw new TypeError(`${name} must be a valid database name.`);
  }
  return result;
}

function asSchemaName(value: unknown, name: string): string {
  const result = asString(value, name, { maxLength: 63 });
  if (!SCHEMA_NAME_PATTERN.test(result)) {
    throw new TypeError(`${name} must be a valid schema name.`);
  }
  return result;
}

function asTableName(value: unknown, name: string): string {
  const result = asString(value, name, { maxLength: 63 });
  if (!SCHEMA_NAME_PATTERN.test(result)) {
    throw new TypeError(`${name} must be a valid table name.`);
  }
  return result;
}

function asOptionalRoleNameList(
  value: unknown,
  name: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError(`${name} must be an array of at most 64 role names.`);
  }
  return value.map((item, index) => asRoleName(item, `${name}[${index}]`));
}

export function validateCreateRoleInput(value: unknown): CreateRoleInput {
  assertSerializedSize(value, "createRole");
  const input = asRecord(value, "createRole");
  assertAllowedKeys(input, "createRole", [
    "connectionId",
    "name",
    "password",
    "login",
    "createRole",
    "createDb",
    "inherit",
    "connectionLimit",
    "validUntil",
    "membershipRoles",
  ]);
  asString(input.connectionId, "createRole.connectionId");
  asRoleName(input.name, "createRole.name");
  asOptionalString(input.password, "createRole.password", {
    maxLength: 1_000,
    allowEmpty: true,
  });
  asBoolean(input.login, "createRole.login");
  if (input.createRole !== undefined) {
    asBoolean(input.createRole, "createRole.createRole");
  }
  if (input.createDb !== undefined) {
    asBoolean(input.createDb, "createRole.createDb");
  }
  if (input.inherit !== undefined) {
    asBoolean(input.inherit, "createRole.inherit");
  }
  if (input.connectionLimit !== undefined) {
    asInteger(
      input.connectionLimit,
      "createRole.connectionLimit",
      -1,
      1_000_000,
    );
  }
  if (input.validUntil !== undefined) {
    asOptionalString(input.validUntil, "createRole.validUntil", {
      maxLength: 64,
    });
  }
  asOptionalRoleNameList(input.membershipRoles, "createRole.membershipRoles");
  return value as CreateRoleInput;
}

export function validateAlterRoleInput(value: unknown): AlterRoleInput {
  assertSerializedSize(value, "alterRole");
  const input = asRecord(value, "alterRole");
  assertAllowedKeys(input, "alterRole", [
    "connectionId",
    "name",
    "password",
    "login",
    "createRole",
    "createDb",
    "connectionLimit",
    "validUntil",
  ]);
  asString(input.connectionId, "alterRole.connectionId");
  asRoleName(input.name, "alterRole.name");
  if (input.password !== undefined && input.password !== null) {
    asString(input.password, "alterRole.password", {
      maxLength: 1_000,
      allowEmpty: true,
    });
  }
  if (input.login !== undefined) {
    asBoolean(input.login, "alterRole.login");
  }
  if (input.createRole !== undefined) {
    asBoolean(input.createRole, "alterRole.createRole");
  }
  if (input.createDb !== undefined) {
    asBoolean(input.createDb, "alterRole.createDb");
  }
  if (input.connectionLimit !== undefined) {
    asInteger(
      input.connectionLimit,
      "alterRole.connectionLimit",
      -1,
      1_000_000,
    );
  }
  if (input.validUntil !== undefined && input.validUntil !== null) {
    asString(input.validUntil, "alterRole.validUntil", { maxLength: 64 });
  }
  return value as AlterRoleInput;
}

export function validateMembershipInput(value: unknown): MembershipInput {
  assertSerializedSize(value, "membershipInput");
  const input = asRecord(value, "membershipInput");
  assertAllowedKeys(input, "membershipInput", [
    "connectionId",
    "memberName",
    "parentRoleName",
    "withAdminOption",
  ]);
  asString(input.connectionId, "membershipInput.connectionId");
  asRoleName(input.memberName, "membershipInput.memberName");
  asRoleName(input.parentRoleName, "membershipInput.parentRoleName");
  if (input.withAdminOption !== undefined) {
    asBoolean(input.withAdminOption, "membershipInput.withAdminOption");
  }
  return value as MembershipInput;
}

export function validateDbAccessInput(value: unknown): DbAccessInput {
  assertSerializedSize(value, "dbAccessInput");
  const input = asRecord(value, "dbAccessInput");
  assertAllowedKeys(input, "dbAccessInput", [
    "connectionId",
    "userName",
    "databaseName",
  ]);
  asString(input.connectionId, "dbAccessInput.connectionId");
  asRoleName(input.userName, "dbAccessInput.userName");
  asDatabaseName(input.databaseName, "dbAccessInput.databaseName");
  return value as DbAccessInput;
}

export function validateDbReadonlyGrantInput(
  value: unknown,
): DbReadonlyGrantInput {
  assertSerializedSize(value, "dbReadonlyGrantInput");
  const input = asRecord(value, "dbReadonlyGrantInput");
  assertAllowedKeys(input, "dbReadonlyGrantInput", [
    "connectionId",
    "userName",
    "databaseName",
    "schema",
  ]);
  asString(input.connectionId, "dbReadonlyGrantInput.connectionId");
  asRoleName(input.userName, "dbReadonlyGrantInput.userName");
  asDatabaseName(input.databaseName, "dbReadonlyGrantInput.databaseName");
  if (input.schema !== undefined) {
    asSchemaName(input.schema, "dbReadonlyGrantInput.schema");
  }
  return value as DbReadonlyGrantInput;
}

export function validateDropRoleInput(value: unknown): {
  connectionId: string;
  name: string;
} {
  assertSerializedSize(value, "dropRoleInput");
  const input = asRecord(value, "dropRoleInput");
  assertAllowedKeys(input, "dropRoleInput", ["connectionId", "name"]);
  asString(input.connectionId, "dropRoleInput.connectionId");
  asRoleName(input.name, "dropRoleInput.name");
  return value as { connectionId: string; name: string };
}

export function validateAlterRolePasswordInput(value: unknown): {
  connectionId: string;
  name: string;
  password: string;
} {
  assertSerializedSize(value, "alterRolePasswordInput");
  const input = asRecord(value, "alterRolePasswordInput");
  assertAllowedKeys(input, "alterRolePasswordInput", [
    "connectionId",
    "name",
    "password",
  ]);
  asString(input.connectionId, "alterRolePasswordInput.connectionId");
  asRoleName(input.name, "alterRolePasswordInput.name");
  asString(input.password, "alterRolePasswordInput.password", {
    maxLength: 1_000,
    allowEmpty: true,
  });
  return value as { connectionId: string; name: string; password: string };
}

export function validateAlterRoleCommentInput(value: unknown): {
  connectionId: string;
  name: string;
  comment: string | null;
} {
  assertSerializedSize(value, "alterRoleCommentInput");
  const input = asRecord(value, "alterRoleCommentInput");
  assertAllowedKeys(input, "alterRoleCommentInput", [
    "connectionId",
    "name",
    "comment",
  ]);
  asString(input.connectionId, "alterRoleCommentInput.connectionId");
  asRoleName(input.name, "alterRoleCommentInput.name");
  if (input.comment !== null) {
    asString(input.comment, "alterRoleCommentInput.comment", {
      maxLength: 10_000,
      allowEmpty: true,
    });
  }
  return value as {
    connectionId: string;
    name: string;
    comment: string | null;
  };
}

export function validateRolesSnapshotInput(value: unknown): {
  connectionId: string;
  targetUser?: string;
} {
  const record = asRecord(value, "rolesSnapshotInput");
  assertAllowedKeys(record, "rolesSnapshotInput", [
    "connectionId",
    "targetUser",
  ]);
  asString(record.connectionId, "rolesSnapshotInput.connectionId");
  if (record.targetUser !== undefined) {
    asRoleName(record.targetUser, "rolesSnapshotInput.targetUser");
  }
  return value as { connectionId: string; targetUser?: string };
}

export function validateSetDbAccessLevelInput(
  value: unknown,
): SetDbAccessLevelInput {
  assertSerializedSize(value, "setDbAccessLevelInput");
  const input = asRecord(value, "setDbAccessLevelInput");
  assertAllowedKeys(input, "setDbAccessLevelInput", [
    "connectionId",
    "userName",
    "databaseName",
    "level",
    "applyToFutureTables",
    "restrictedTables",
  ]);
  asString(input.connectionId, "setDbAccessLevelInput.connectionId");
  asRoleName(input.userName, "setDbAccessLevelInput.userName");
  asDatabaseName(input.databaseName, "setDbAccessLevelInput.databaseName");
  if (
    typeof input.level !== "string" ||
    !["none", "readonly", "readwrite"].includes(input.level)
  ) {
    throw new TypeError("setDbAccessLevelInput.level must be none/readonly/readwrite.");
  }
  asBoolean(
    input.applyToFutureTables,
    "setDbAccessLevelInput.applyToFutureTables",
  );
  if (input.restrictedTables !== undefined) {
    validateStringArray(
      input.restrictedTables,
      "setDbAccessLevelInput.restrictedTables",
      1_000,
    );
  }
  return value as SetDbAccessLevelInput;
}

export function validateTableRestrictionInput(
  value: unknown,
): TableRestrictionInput {
  assertSerializedSize(value, "tableRestrictionInput");
  const input = asRecord(value, "tableRestrictionInput");
  assertAllowedKeys(input, "tableRestrictionInput", [
    "connectionId",
    "userName",
    "databaseName",
    "tables",
  ]);
  asString(input.connectionId, "tableRestrictionInput.connectionId");
  asRoleName(input.userName, "tableRestrictionInput.userName");
  asDatabaseName(input.databaseName, "tableRestrictionInput.databaseName");
  if (!Array.isArray(input.tables) || input.tables.length > 1_000) {
    throw new TypeError(
      "tableRestrictionInput.tables must be an array of at most 1000 entries.",
    );
  }
  for (let index = 0; index < input.tables.length; index += 1) {
    const entry = asRecord(input.tables[index], `tableRestrictionInput.tables[${index}]`);
    assertAllowedKeys(entry, `tableRestrictionInput.tables[${index}]`, [
      "schema",
      "name",
      "level",
    ]);
    asSchemaName(
      entry.schema,
      `tableRestrictionInput.tables[${index}].schema`,
    );
    asTableName(
      entry.name,
      `tableRestrictionInput.tables[${index}].name`,
    );
    if (
      typeof entry.level !== "string" ||
      !["none", "readonly", "readwrite"].includes(entry.level)
    ) {
      throw new TypeError(
        `tableRestrictionInput.tables[${index}].level must be none/readonly/readwrite.`,
      );
    }
  }
  return value as TableRestrictionInput;
}

export function validateCloneRoleInput(value: unknown): CloneRoleInput {
  assertSerializedSize(value, "cloneRoleInput");
  const input = asRecord(value, "cloneRoleInput");
  assertAllowedKeys(input, "cloneRoleInput", [
    "connectionId",
    "sourceName",
    "newName",
  ]);
  asString(input.connectionId, "cloneRoleInput.connectionId");
  asRoleName(input.sourceName, "cloneRoleInput.sourceName");
  asRoleName(input.newName, "cloneRoleInput.newName");
  return value as CloneRoleInput;
}

export function validateRenameRoleInput(value: unknown): RenameRoleInput {
  assertSerializedSize(value, "renameRoleInput");
  const input = asRecord(value, "renameRoleInput");
  assertAllowedKeys(input, "renameRoleInput", [
    "connectionId",
    "oldName",
    "newName",
  ]);
  asString(input.connectionId, "renameRoleInput.connectionId");
  asRoleName(input.oldName, "renameRoleInput.oldName");
  asRoleName(input.newName, "renameRoleInput.newName");
  return value as RenameRoleInput;
}

const TRIGGER_EVENT_VALUES = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];
const TRIGGER_TIMING_VALUES = ["BEFORE", "AFTER", "INSTEAD OF"];
const TRIGGER_ORIENTATION_VALUES = ["ROW", "STATEMENT"];

export function validateCreateTriggerInput(
  value: unknown,
): CreateTriggerInput {
  assertSerializedSize(value, "createTriggerInput");
  const input = asRecord(value, "createTriggerInput");
  assertAllowedKeys(input, "createTriggerInput", [
    "connectionId",
    "databaseName",
    "schemaName",
    "tableName",
    "triggerName",
    "timing",
    "events",
    "orientation",
    "functionSchema",
    "functionName",
    "functionArgs",
  ]);
  asString(input.connectionId, "createTriggerInput.connectionId");
  asDatabaseName(input.databaseName, "createTriggerInput.databaseName");
  asSchemaName(input.schemaName, "createTriggerInput.schemaName");
  asString(input.tableName, "createTriggerInput.tableName", {
    maxLength: 63,
  });
  asString(input.triggerName, "createTriggerInput.triggerName", {
    maxLength: 63,
  });
  if (
    typeof input.timing !== "string" ||
    !TRIGGER_TIMING_VALUES.includes(input.timing)
  ) {
    throw new TypeError("createTriggerInput.timing is invalid.");
  }
  if (
    typeof input.orientation !== "string" ||
    !TRIGGER_ORIENTATION_VALUES.includes(input.orientation)
  ) {
    throw new TypeError("createTriggerInput.orientation is invalid.");
  }
  if (
    !Array.isArray(input.events) ||
    input.events.length === 0 ||
    input.events.length > 4
  ) {
    throw new TypeError(
      "createTriggerInput.events must be a non-empty array (max 4).",
    );
  }
  for (const event of input.events) {
    if (typeof event !== "string" || !TRIGGER_EVENT_VALUES.includes(event)) {
      throw new TypeError("createTriggerInput.events contains an invalid value.");
    }
  }
  asSchemaName(input.functionSchema, "createTriggerInput.functionSchema");
  asString(input.functionName, "createTriggerInput.functionName", {
    maxLength: 63,
  });
  asOptionalString(input.functionArgs, "createTriggerInput.functionArgs", {
    maxLength: 4_000,
  });
  return value as CreateTriggerInput;
}

export function validateDropTriggerInput(value: unknown): DropTriggerInput {
  assertSerializedSize(value, "dropTriggerInput");
  const input = asRecord(value, "dropTriggerInput");
  assertAllowedKeys(input, "dropTriggerInput", [
    "connectionId",
    "databaseName",
    "schemaName",
    "tableName",
    "triggerName",
  ]);
  asString(input.connectionId, "dropTriggerInput.connectionId");
  asDatabaseName(input.databaseName, "dropTriggerInput.databaseName");
  asSchemaName(input.schemaName, "dropTriggerInput.schemaName");
  asString(input.tableName, "dropTriggerInput.tableName", {
    maxLength: 63,
  });
  asString(input.triggerName, "dropTriggerInput.triggerName", {
    maxLength: 63,
  });
  return value as DropTriggerInput;
}

export function validateSetTriggerEnabledInput(
  value: unknown,
): SetTriggerEnabledInput {
  assertSerializedSize(value, "setTriggerEnabledInput");
  const input = asRecord(value, "setTriggerEnabledInput");
  assertAllowedKeys(input, "setTriggerEnabledInput", [
    "connectionId",
    "databaseName",
    "schemaName",
    "tableName",
    "triggerName",
    "enabled",
  ]);
  asString(input.connectionId, "setTriggerEnabledInput.connectionId");
  asDatabaseName(input.databaseName, "setTriggerEnabledInput.databaseName");
  asSchemaName(input.schemaName, "setTriggerEnabledInput.schemaName");
  asString(input.tableName, "setTriggerEnabledInput.tableName", {
    maxLength: 63,
  });
  asString(input.triggerName, "setTriggerEnabledInput.triggerName", {
    maxLength: 63,
  });
  asBoolean(input.enabled, "setTriggerEnabledInput.enabled");
  return value as SetTriggerEnabledInput;
}

export function validateCreateTriggerFunctionInput(
  value: unknown,
): CreateTriggerFunctionInput {
  assertSerializedSize(value, "createTriggerFunctionInput", 100_000);
  const input = asRecord(value, "createTriggerFunctionInput");
  assertAllowedKeys(input, "createTriggerFunctionInput", [
    "connectionId",
    "databaseName",
    "schemaName",
    "functionName",
    "source",
  ]);
  asString(input.connectionId, "createTriggerFunctionInput.connectionId");
  asDatabaseName(
    input.databaseName,
    "createTriggerFunctionInput.databaseName",
  );
  asSchemaName(input.schemaName, "createTriggerFunctionInput.schemaName");
  asString(input.functionName, "createTriggerFunctionInput.functionName", {
    maxLength: 63,
  });
  asString(input.source, "createTriggerFunctionInput.source", {
    maxLength: MAX_SQL_LENGTH,
  });
  return value as CreateTriggerFunctionInput;
}

export function validateTriggerListInput(value: unknown): {
  connectionId: string;
  databaseName: string;
} {
  const record = asRecord(value, "triggerListInput");
  assertAllowedKeys(record, "triggerListInput", [
    "connectionId",
    "databaseName",
  ]);
  asString(record.connectionId, "triggerListInput.connectionId");
  asDatabaseName(
    record.databaseName,
    "triggerListInput.databaseName",
  );
  return value as { connectionId: string; databaseName: string };
}

export function validateConnectionUserInput(value: unknown): {
  connectionId: string;
  user: string;
} {
  const record = asRecord(value, "connectionUserInput");
  assertAllowedKeys(record, "connectionUserInput", ["connectionId", "user"]);
  asString(record.connectionId, "connectionUserInput.connectionId");
  asRoleName(record.user, "connectionUserInput.user");
  return value as { connectionId: string; user: string };
}

export function validateConnectionIdInput(value: unknown): {
  connectionId: string;
} {
  const record = asRecord(value, "connectionIdInput");
  assertAllowedKeys(record, "connectionIdInput", ["connectionId"]);
  asString(record.connectionId, "connectionIdInput.connectionId");
  return value as { connectionId: string };
}

// ---------------------------------------------------------------------------
// Database Sync
// ---------------------------------------------------------------------------

function asRunId(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new TypeError(`${name} must be a run identifier.`);
  }
  return value;
}

function asDbSyncEndpoint(value: unknown, name: string): DbSyncEndpoint {
  const record = asRecord(value, name);
  assertAllowedKeys(record, name, ["connectionId", "database"]);
  asString(record.connectionId, `${name}.connectionId`);
  asString(record.database, `${name}.database`);
  return record as unknown as DbSyncEndpoint;
}

function asDbSyncMode(value: unknown, name: string): DbSyncMode {
  if (value !== "full-override" && value !== "row-sync") {
    throw new TypeError(`${name} must be "full-override" or "row-sync".`);
  }
  return value;
}

export function validateDbSyncListDatabasesInput(
  value: unknown,
): DbSyncListDatabasesInput {
  const record = asRecord(value, "dbSyncListDatabasesInput");
  assertAllowedKeys(record, "dbSyncListDatabasesInput", ["connectionId"]);
  asString(record.connectionId, "dbSyncListDatabasesInput.connectionId");
  return value as DbSyncListDatabasesInput;
}

export function validateDbSyncRunInput(value: unknown): DbSyncRunInput {
  const record = asRecord(value, "dbSyncRunInput");
  assertAllowedKeys(record, "dbSyncRunInput", [
    "runId",
    "source",
    "target",
    "mode",
    "backupTarget",
  ]);
  asRunId(record.runId, "dbSyncRunInput.runId");
  asDbSyncEndpoint(record.source, "dbSyncRunInput.source");
  asDbSyncEndpoint(record.target, "dbSyncRunInput.target");
  asDbSyncMode(record.mode, "dbSyncRunInput.mode");
  asOptionalBoolean(record.backupTarget, "dbSyncRunInput.backupTarget");
  return value as DbSyncRunInput;
}

export function validateDbSyncCancelInput(value: unknown): DbSyncCancelInput {
  const record = asRecord(value, "dbSyncCancelInput");
  assertAllowedKeys(record, "dbSyncCancelInput", ["runId"]);
  asRunId(record.runId, "dbSyncCancelInput.runId");
  return value as DbSyncCancelInput;
}

export function validateDbSyncSetProdGuardInput(value: unknown): DbSyncSetProdGuardInput {
  const record = asRecord(value, "dbSyncSetProdGuardInput");
  assertAllowedKeys(record, "dbSyncSetProdGuardInput", ["enabled"]);
  asBoolean(record.enabled, "dbSyncSetProdGuardInput.enabled");
  return value as DbSyncSetProdGuardInput;
}

export function validateDbSyncBackupInput(value: unknown): DbSyncBackupInput {
  const record = asRecord(value, "dbSyncBackupInput");
  assertAllowedKeys(record, "dbSyncBackupInput", ["runId", "source"]);
  asRunId(record.runId, "dbSyncBackupInput.runId");
  asDbSyncEndpoint(record.source, "dbSyncBackupInput.source");
  return value as DbSyncBackupInput;
}

export function validateDbSyncDeleteBackupInput(
  value: unknown,
): DbSyncDeleteBackupInput {
  const record = asRecord(value, "dbSyncDeleteBackupInput");
  assertAllowedKeys(record, "dbSyncDeleteBackupInput", ["path"]);
  asString(record.path, "dbSyncDeleteBackupInput.path", { maxLength: MAX_PATH_LENGTH });
  return value as DbSyncDeleteBackupInput;
}

export function validateDbSyncInspectBackupInput(
  value: unknown,
): DbSyncInspectBackupInput {
  const record = asRecord(value, "dbSyncInspectBackupInput");
  assertAllowedKeys(record, "dbSyncInspectBackupInput", ["path"]);
  asString(record.path, "dbSyncInspectBackupInput.path", { maxLength: MAX_PATH_LENGTH });
  return value as DbSyncInspectBackupInput;
}

export function validateDbSyncRestoreInput(value: unknown): DbSyncRestoreInput {
  const record = asRecord(value, "dbSyncRestoreInput");
  assertAllowedKeys(record, "dbSyncRestoreInput", [
    "runId",
    "target",
    "backupPath",
    "backupTarget",
  ]);
  asRunId(record.runId, "dbSyncRestoreInput.runId");
  asDbSyncEndpoint(record.target, "dbSyncRestoreInput.target");
  asString(record.backupPath, "dbSyncRestoreInput.backupPath", { maxLength: MAX_PATH_LENGTH });
  asOptionalBoolean(record.backupTarget, "dbSyncRestoreInput.backupTarget");
  return value as DbSyncRestoreInput;
}
