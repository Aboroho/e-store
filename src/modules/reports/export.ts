import "server-only";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { formatPaisa } from "@/lib/money";
import type { ReportColumn, ReportResult } from "./queries";

/**
 * Export engine.
 *
 * One place formats a `ReportResult` into a spreadsheet or a PDF, so a new report
 * never needs new export code. Both exporters stream: XLSX writes into a workbook
 * and serialises once (fine for the row caps the reports apply), PDF writes pages as
 * they are produced instead of building one huge string.
 *
 * Colour is never the only signal — totals rows and negative amounts carry labels and
 * signs as well.
 */

export type ExportFormat = "xlsx" | "pdf";

export function isExportFormat(value: string | null): value is ExportFormat {
  return value === "xlsx" || value === "pdf";
}

function formatCell(column: ReportColumn, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  switch (column.format) {
    case "paisa":
      return formatPaisa(Number(value));
    case "number":
      return new Intl.NumberFormat("en-BD").format(Number(value));
    case "percent":
      return `${Number(value).toFixed(2)}%`;
    case "date": {
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace("T", " ").slice(0, 16);
    }
    default:
      return String(value);
  }
}

function numericCell(column: ReportColumn, value: string | number | null | undefined): number | string {
  if (value === null || value === undefined || value === "") return "";
  if (column.format === "paisa" || column.format === "number" || column.format === "percent") return Number(value) / (column.format === "paisa" ? 100 : 1);
  return String(value);
}

function allTables(report: ReportResult) {
  return [
    { title: report.title, columns: report.columns, rows: report.rows, totals: report.totals },
    ...(report.sections ?? []).map((section) => ({ title: section.title, columns: section.columns, rows: section.rows, totals: section.totals })),
  ];
}

function metaLines(report: ReportResult): string[] {
  const lines = [`Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`];
  for (const [key, value] of Object.entries(report.meta)) {
    lines.push(`${key}: ${value}`);
  }
  return lines;
}

/** XLSX with one sheet per table, a frozen header and a bold totals row. */
export async function reportToXlsx(report: ReportResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "E-Store";
  workbook.created = new Date();

  const tables = allTables(report);

  tables.forEach((table, index) => {
    const safeName = table.title.replace(/[\\/*?:[\]]/g, "-").slice(0, 31) || `Report ${index + 1}`;
    const sheet = workbook.addWorksheet(safeName, { views: [{ state: "frozen", ySplit: 4 }] });

    sheet.addRow([report.title]).font = { bold: true, size: 14 };
    sheet.addRow([report.description]);
    sheet.addRow(metaLines(report).join("  ·  "));
    sheet.addRow([]);

    const header = sheet.addRow(table.columns.map((column) => column.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
    });

    for (const row of table.rows) {
      const values = table.columns.map((column) => numericCell(column, row[column.key]));
      const dataRow = sheet.addRow(values);
      table.columns.forEach((column, columnIndex) => {
        if (column.format === "paisa") {
          dataRow.getCell(columnIndex + 1).numFmt = "#,##0.00";
          if (typeof values[columnIndex] === "number" && (values[columnIndex] as number) < 0) {
            dataRow.getCell(columnIndex + 1).font = { color: { argb: "FFB91C1C" } };
          }
        } else if (column.format === "number") {
          dataRow.getCell(columnIndex + 1).numFmt = "#,##0";
        } else if (column.format === "percent") {
          dataRow.getCell(columnIndex + 1).numFmt = "0.00";
        }
      });
    }

    if (table.totals && Object.keys(table.totals).length > 0) {
      const totalRow = sheet.addRow(
        table.columns.map((column, columnIndex) =>
          columnIndex === 0 ? "TOTAL" : table.totals && column.key in table.totals ? numericCell(column, table.totals[column.key]!) : "",
        ),
      );
      totalRow.font = { bold: true };
      totalRow.eachCell((cell) => {
        cell.border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
      });
    }

    sheet.columns.forEach((column, columnIndex) => {
      const longest = Math.max(
        table.columns[columnIndex]?.label.length ?? 10,
        ...table.rows.slice(0, 200).map((row) => formatCell(table.columns[columnIndex]!, row[table.columns[columnIndex]!.key]).length),
      );
      column.width = Math.min(42, Math.max(10, longest + 2));
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** PDF with a repeatable header, our own table renderer and page numbers. */
export function reportToPdf(report: ReportResult): NodeJS.ReadableStream {
  const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
  const tables = allTables(report);
  const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;

  document.fontSize(16).fillColor("#0f172a").text(report.title);
  document.moveDown(0.2);
  document.fontSize(9).fillColor("#475569").text(report.description, { width: pageWidth });
  document.moveDown(0.2);
  document.fontSize(8).fillColor("#64748b").text(metaLines(report).join("   ·   "), { width: pageWidth });
  document.moveDown(0.8);

  for (const table of tables) {
    document.fontSize(11).fillColor("#0f172a").text(table.title);
    document.moveDown(0.3);

    const columnWidth = pageWidth / table.columns.length;
    const fontSize = table.columns.length > 7 ? 6.5 : 8;
    const rowHeight = fontSize + 6;

    const drawHeader = () => {
      document.fontSize(fontSize).fillColor("#334155");
      table.columns.forEach((column, index) => {
        document.text(column.label, document.page.margins.left + index * columnWidth, document.y, {
          width: columnWidth - 4,
          align: column.align ?? "left",
          lineBreak: false,
        });
      });
      document.moveDown(0.6);
      document
        .moveTo(document.page.margins.left, document.y)
        .lineTo(document.page.margins.left + pageWidth, document.y)
        .strokeColor("#cbd5e1")
        .stroke();
      document.moveDown(0.3);
    };

    drawHeader();

    for (const row of table.rows) {
      if (document.y + rowHeight > document.page.height - document.page.margins.bottom - 24) {
        document.addPage();
        document.fontSize(fontSize).fillColor("#334155").text(`${report.title} (continued)`);
        document.moveDown(0.4);
        drawHeader();
      }
      const y = document.y;
      document.fontSize(fontSize).fillColor("#0f172a");
      table.columns.forEach((column, index) => {
        const value = formatCell(column, row[column.key]);
        document.text(value, document.page.margins.left + index * columnWidth, y, {
          width: columnWidth - 4,
          align: column.align ?? "left",
          lineBreak: false,
          ellipsis: true,
        });
      });
      document.y = y + rowHeight - 2;
    }

    if (table.totals && Object.keys(table.totals).length > 0) {
      if (document.y + rowHeight > document.page.height - document.page.margins.bottom - 24) {
        document.addPage();
      }
      const y = document.y;
      document.fontSize(fontSize + 0.5).fillColor("#0f172a");
      table.columns.forEach((column, index) => {
        const value = index === 0 ? "TOTAL" : table.totals && column.key in table.totals ? formatCell(column, table.totals[column.key]!) : "";
        document.text(value, document.page.margins.left + index * columnWidth, y, {
          width: columnWidth - 4,
          align: column.align ?? "left",
          lineBreak: false,
          ellipsis: true,
        });
      });
      document.y = y + rowHeight;
    }

    document.moveDown(1);
  }

  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    document
      .fontSize(8)
      .fillColor("#94a3b8")
      .text(
        `E-Store · ${report.title} · page ${index + 1} of ${range.count}`,
        document.page.margins.left,
        document.page.height - document.page.margins.bottom + 6,
        { width: pageWidth, align: "right" },
      );
  }

  document.end();
  return document as unknown as NodeJS.ReadableStream;
}

export function exportFileName(report: ReportResult, format: ExportFormat): string {
  const from = String(report.meta.from ?? "").replace(/[^\d-]/g, "") || new Date().toISOString().slice(0, 10);
  const to = String(report.meta.to ?? "").replace(/[^\d-]/g, "") || new Date().toISOString().slice(0, 10);
  return `${report.key}-${from}_${to}.${format}`;
}

export function exportContentType(format: ExportFormat): string {
  return format === "xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "application/pdf";
}

/** CSV for the reports that people paste into a sheet or an email. */
export function reportToCsv(report: ReportResult): string {
  const escape = (value: string) => (value.includes(",") || value.includes('"') ? `"${value.replace(/"/g, '""')}"` : value);
  const lines: string[] = [escape(report.title), escape(report.description), ""];

  for (const table of allTables(report)) {
    lines.push(escape(table.title));
    lines.push(table.columns.map((column) => escape(column.label)).join(","));
    for (const row of table.rows) {
      lines.push(table.columns.map((column) => escape(formatCell(column, row[column.key]))).join(","));
    }
    if (table.totals) {
      lines.push(table.columns.map((column, index) => escape(index === 0 ? "TOTAL" : column.key in (table.totals ?? {}) ? formatCell(column, table.totals![column.key]!) : "")).join(","));
    }
    lines.push("");
  }

  return lines.join("\n");
}
