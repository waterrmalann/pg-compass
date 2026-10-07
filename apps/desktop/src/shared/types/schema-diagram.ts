/** Catalog snapshot that the database Diagram tab draws as an ER diagram. */

export interface SchemaDiagramParams {
  connectionId: string;
  /** Schemas to include. Foreign keys are returned for tables in these. */
  schemas: string[];
}

export interface DiagramColumn {
  name: string;
  /** Formatted type, e.g. `character varying(255)` or `app.user_role[]`. */
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  /** Covered on its own by a unique constraint or unique index. */
  isUnique: boolean;
}

export interface DiagramTable {
  schema: string;
  name: string;
  /** Columns in table order. */
  columns: DiagramColumn[];
}

export interface DiagramForeignKey {
  name: string;
  sourceSchema: string;
  sourceTable: string;
  /** Referencing columns, in key order. */
  sourceColumns: string[];
  targetSchema: string;
  targetTable: string;
  /** Referenced columns, in the same order as `sourceColumns`. */
  targetColumns: string[];
}

export interface SchemaDiagram {
  tables: DiagramTable[];
  foreignKeys: DiagramForeignKey[];
}
