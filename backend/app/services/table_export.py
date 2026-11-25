"""Export tabular admin data as CSV, Excel (.xlsx) or PDF."""

from __future__ import annotations

import csv
import io
from typing import Literal

ExportFormat = Literal["csv", "xlsx", "pdf"]

MEDIA_TYPES = {
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}


def _safe_cell(value: object) -> str:
    """Neutralise spreadsheet formula injection (cells starting with = + - @ or control chars)."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def to_csv(headers: list[str], rows: list[list[object]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows([[_safe_cell(v) for v in row] for row in rows])
    # BOM so Excel opens UTF-8 (names with accents etc.) correctly.
    return ("﻿" + buf.getvalue()).encode("utf-8")


def to_xlsx(headers: list[str], rows: list[list[object]], sheet: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = sheet[:31]
    ws.append(headers)
    for row in rows:
        ws.append([v if isinstance(v, (int, float)) else _safe_cell(v) for v in row])

    header_fill = PatternFill("solid", fgColor="0F1B2D")
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for idx, header in enumerate(headers, start=1):
        width = max([len(str(header))] + [len(str(r[idx - 1] or "")) for r in rows[:500]])
        ws.column_dimensions[get_column_letter(idx)].width = min(max(width + 2, 10), 60)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def to_pdf(headers: list[str], rows: list[list[object]], title: str, subtitle: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm)
    styles = getSampleStyleSheet()
    cell_style = styles["BodyText"].clone("cell", fontSize=8, leading=10)

    def para(v: object) -> Paragraph:
        text = "" if v is None else str(v)
        return Paragraph(text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), cell_style)

    data = [headers] + [[para(v) for v in row] for row in rows]
    table = Table(data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F1B2D")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8.5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    doc.build([Paragraph(title, styles["Title"]), Paragraph(subtitle, styles["Normal"]), Spacer(1, 6 * mm), table])
    return buf.getvalue()


def render(fmt: ExportFormat, headers: list[str], rows: list[list[object]], *, title: str, subtitle: str) -> bytes:
    if fmt == "csv":
        return to_csv(headers, rows)
    if fmt == "xlsx":
        return to_xlsx(headers, rows, sheet=title)
    return to_pdf(headers, rows, title=title, subtitle=subtitle)
