import type { ImageMetadata } from "astro";
import dataDark from "../assets/screenshots/data-dark.png";
import dataLight from "../assets/screenshots/data-light.png";
import cardsDark from "../assets/screenshots/cards-dark.png";
import cardsLight from "../assets/screenshots/cards-light.png";
import structureDark from "../assets/screenshots/structure-dark.png";
import structureLight from "../assets/screenshots/structure-light.png";
import queryDark from "../assets/screenshots/query-dark.png";
import queryLight from "../assets/screenshots/query-light.png";

export interface Scene {
  id: string;
  label: string;
  caption: string;
  alt: string;
  title: string;
  dark: ImageMetadata;
  light: ImageMetadata;
}

// Screenshots are captured from the real app by scripts/screenshots.
export const scenes: Scene[] = [
  {
    id: "data",
    label: "Browse rows",
    caption: "Page through a table 25 to 100 rows at a time. Every column shows its type under its name.",
    alt: "PG Compass showing the orders table from a production connection, 50 rows per page.",
    title: "Production / shop / orders",
    dark: dataDark,
    light: dataLight,
  },
  {
    id: "cards",
    label: "Read documents",
    caption: "Card view lays each row out as a document, with JSONB expanded into a tree.",
    alt: "PG Compass card view of a customers row with its JSONB preferences expanded.",
    title: "Production / shop / customers",
    dark: cardsDark,
    light: cardsLight,
  },
  {
    id: "structure",
    label: "Check structure",
    caption: "Columns, types, defaults and a few sample values, one tab over from the data.",
    alt: "PG Compass structure tab listing the columns of the customers table.",
    title: "Production / shop / customers",
    dark: structureDark,
    light: structureLight,
  },
  {
    id: "query",
    label: "Run a query",
    caption: "Write a SELECT, press Ctrl+Enter, and read the results in the same grid.",
    alt: "PG Compass query tab with a SQL query and its results.",
    title: "Production / shop / orders",
    dark: queryDark,
    light: queryLight,
  },
];
