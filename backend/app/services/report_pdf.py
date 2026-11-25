"""Downloadable PDF of a resume analysis report."""

from __future__ import annotations

import io
from datetime import datetime

from app.schemas.resume import ParsedResume, ResumeAnalysis

BREAKDOWN_LABELS = [("content", "Content"), ("impact", "Impact"), ("ats", "ATS"), ("formatting", "Formatting"), ("skills", "Skills")]


def _tone(score: int) -> str:
    return "#10b981" if score >= 80 else "#3b82f6" if score >= 60 else "#f59e0b" if score >= 40 else "#f43f5e"


def build_report_pdf(
    analysis: ResumeAnalysis,
    parsed: ParsedResume | None,
    *,
    app_name: str,
    title: str,
    job_title: str | None = None,
    generated_at: datetime | None = None,
) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm, title=title)
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=20, leading=24, alignment=0, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12.5, leading=16, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#0f1b2d"))
    body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=9.5, leading=13)
    muted = ParagraphStyle("muted", parent=body, textColor=colors.HexColor("#64748b"), fontSize=8.5)

    def esc(text: object) -> str:
        return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def bullets(items: list[str], mark: str, color: str) -> list:
        if not items:
            return [Paragraph("Nothing here.", muted)]
        return [Paragraph(f'<font color="{color}"><b>{mark}</b></font>&nbsp;&nbsp;{esc(i)}', body) for i in items]

    story: list = []
    when = (generated_at or datetime.now()).strftime("%d %b %Y, %H:%M")
    story.append(Paragraph(f"{esc(app_name)} · Resume report", muted))
    story.append(Paragraph(esc(title), h1))
    if job_title:
        story.append(Paragraph(f"Reviewed for: <b>{esc(job_title)}</b>", body))
    story.append(Paragraph(f"Generated {when}", muted))
    story.append(Spacer(1, 6 * mm))

    # Score + breakdown
    score_cell = Paragraph(
        f'<para alignment="center"><font size="30" color="{_tone(analysis.score)}"><b>{analysis.score}</b></font><br/>'
        f'<font size="9" color="#64748b">out of 100</font></para>',
        body,
    )
    rows = []
    if analysis.score_breakdown:
        for key, label in BREAKDOWN_LABELS:
            v = getattr(analysis.score_breakdown, key)
            bar = Table([["", ""]], colWidths=[max(v, 1) * 0.9 * mm, max(100 - v, 0) * 0.9 * mm + 0.1], rowHeights=[3.2 * mm])
            bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), colors.HexColor(_tone(v))), ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#e2e8f0"))]))
            rows.append([Paragraph(label, body), bar, Paragraph(f"<b>{v}</b>", body)])
    breakdown = Table(rows, colWidths=[24 * mm, 92 * mm, 12 * mm]) if rows else Paragraph(
        f"{len(analysis.weaknesses)} issues · {len(analysis.suggestions or [])} suggestions · {len(analysis.strengths)} strengths", body
    )
    if rows:
        breakdown.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    top = Table([[score_cell, breakdown]], colWidths=[38 * mm, 140 * mm])
    top.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#e2e8f0")),
                ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#f8fafc")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(top)

    if analysis.job_match:
        jm = analysis.job_match
        story.append(Paragraph(f"Job match — {jm.score}%", h2))
        story.append(Paragraph("<b>Matched:</b> " + (esc(", ".join(jm.matched)) or "none"), body))
        story.append(Paragraph('<b><font color="#e11d48">Missing:</font></b> ' + (esc(", ".join(jm.missing)) or "none"), body))

    story.append(Paragraph("Issues found", h2))
    story += bullets(analysis.weaknesses, "•", "#e11d48")
    story.append(Paragraph("What to add / fix", h2))
    story += bullets(analysis.suggestions or [], "•", "#2563eb")
    story.append(Paragraph("Strengths", h2))
    story += bullets(analysis.strengths, "•", "#059669")
    if analysis.missing_keywords:
        story.append(Paragraph("Missing ATS keywords", h2))
        story.append(Paragraph(esc(", ".join(analysis.missing_keywords)), body))

    if analysis.bullet_rewrites:
        story.append(Paragraph("Suggested bullet rewrites", h2))
        for rw in analysis.bullet_rewrites:
            t = Table(
                [[Paragraph("<b>Before</b>", muted), Paragraph(esc(rw.original), body)], [Paragraph('<b><font color="#059669">After</font></b>', muted), Paragraph(esc(rw.improved), body)]],
                colWidths=[18 * mm, 160 * mm],
            )
            t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")), ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#f0fdf4")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            story.append(KeepTogether([t, Spacer(1, 2.5 * mm)]))

    fb = [
        ("Content", [("Clarity", analysis.content_feedback.clarity), ("Impact", analysis.content_feedback.impact), ("Relevance", analysis.content_feedback.relevance)]),
        ("Quality", [("Grammar", analysis.quality_feedback.grammar), ("Formatting", analysis.quality_feedback.formatting), ("Conciseness", analysis.quality_feedback.conciseness)]),
        ("ATS", [("Keyword coverage", analysis.ats_feedback.keyword_coverage), ("Formatting compatibility", analysis.ats_feedback.formatting_compatibility)]),
    ]
    story.append(Paragraph("Detailed feedback", h2))
    for group, items in fb:
        for label, text in items:
            if text:
                story.append(Paragraph(f"<b>{group} · {label}:</b> {esc(text)}", body))
                story.append(Spacer(1, 1.5 * mm))

    if parsed and parsed.skills:
        story.append(Paragraph("Skills found in the resume", h2))
        story.append(Paragraph(esc(", ".join(parsed.skills)), body))

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(f"Generated by {esc(app_name)}. AI feedback can be imperfect; review suggestions before using them.", muted))
    doc.build(story)
    return buf.getvalue()
