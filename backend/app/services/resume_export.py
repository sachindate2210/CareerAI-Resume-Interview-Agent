from __future__ import annotations

import io

from app.schemas.resume import ParsedResume


def _escape(value):
    """reportlab Paragraphs parse markup, so user text must be escaped (& < >)."""
    if isinstance(value, str):
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    if isinstance(value, list):
        return [_escape(v) for v in value]
    if isinstance(value, dict):
        return {k: _escape(v) for k, v in value.items()}
    return value


def export_resume_pdf(resume: ParsedResume) -> bytes:
    resume = ParsedResume.model_validate(_escape(resume.model_dump()))
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=LETTER, topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        leftMargin=0.7 * inch, rightMargin=0.7 * inch,
    )
    styles = getSampleStyleSheet()
    name_style = ParagraphStyle("NameStyle", parent=styles["Title"], fontSize=20, spaceAfter=2)
    contact_style = ParagraphStyle("ContactStyle", parent=styles["Normal"], fontSize=9, textColor="#444444")
    section_style = ParagraphStyle(
        "SectionStyle", parent=styles["Heading2"], fontSize=12, spaceBefore=12, spaceAfter=4,
        textColor="#1a1a1a", borderPadding=0,
    )
    body_style = ParagraphStyle("BodyStyle", parent=styles["Normal"], fontSize=10, leading=13)
    subheading_style = ParagraphStyle("SubheadingStyle", parent=styles["Normal"], fontSize=10.5, leading=13, spaceAfter=0)

    story = []

    story.append(Paragraph(resume.name or "Resume", name_style))
    contact_bits = [c for c in [resume.email, resume.phone, ", ".join(resume.links)] if c]
    if contact_bits:
        story.append(Paragraph(" | ".join(contact_bits), contact_style))
    story.append(Spacer(1, 8))

    if resume.summary:
        story.append(Paragraph("Summary", section_style))
        story.append(Paragraph(resume.summary, body_style))

    if resume.skills:
        story.append(Paragraph("Skills", section_style))
        story.append(Paragraph(", ".join(resume.skills), body_style))

    if resume.experience:
        story.append(Paragraph("Experience", section_style))
        for exp in resume.experience:
            header = " — ".join(p for p in [exp.title, exp.company] if p)
            dates = " – ".join(p for p in [exp.start_date, exp.end_date] if p)
            line = f"<b>{header}</b>" + (f" ({dates})" if dates else "")
            if exp.location:
                line += f", {exp.location}"
            story.append(Paragraph(line, subheading_style))
            if exp.bullets:
                story.append(
                    ListFlowable(
                        [ListItem(Paragraph(b, body_style)) for b in exp.bullets],
                        bulletType="bullet", start="•", leftIndent=14,
                    )
                )
            story.append(Spacer(1, 6))

    if resume.projects:
        story.append(Paragraph("Projects", section_style))
        for proj in resume.projects:
            header = proj.name or "Project"
            if proj.technologies:
                header += f" ({', '.join(proj.technologies)})"
            story.append(Paragraph(f"<b>{header}</b>", subheading_style))
            if proj.description:
                story.append(Paragraph(proj.description, body_style))
            if proj.bullets:
                story.append(
                    ListFlowable(
                        [ListItem(Paragraph(b, body_style)) for b in proj.bullets],
                        bulletType="bullet", start="•", leftIndent=14,
                    )
                )
            story.append(Spacer(1, 6))

    if resume.education:
        story.append(Paragraph("Education", section_style))
        for edu in resume.education:
            header = " — ".join(p for p in [edu.degree, edu.institution] if p)
            dates = " – ".join(p for p in [edu.start_date, edu.end_date] if p)
            line = header + (f" ({dates})" if dates else "")
            if edu.field:
                line += f", {edu.field}"
            story.append(Paragraph(line, body_style))

    if resume.certifications:
        story.append(Paragraph("Certifications", section_style))
        story.append(
            ListFlowable(
                [ListItem(Paragraph(c, body_style)) for c in resume.certifications],
                bulletType="bullet", start="•", leftIndent=14,
            )
        )

    if resume.achievements:
        story.append(Paragraph("Achievements", section_style))
        story.append(
            ListFlowable(
                [ListItem(Paragraph(a, body_style)) for a in resume.achievements],
                bulletType="bullet", start="•", leftIndent=14,
            )
        )

    doc.build(story)
    return buffer.getvalue()


def export_resume_docx(resume: ParsedResume) -> bytes:
    import docx
    from docx.shared import Pt

    document = docx.Document()

    title = document.add_heading(resume.name or "Resume", level=0)
    title.alignment = 0

    contact_bits = [c for c in [resume.email, resume.phone, ", ".join(resume.links)] if c]
    if contact_bits:
        p = document.add_paragraph(" | ".join(contact_bits))
        p.runs[0].font.size = Pt(9)

    def add_section(title_text: str) -> None:
        document.add_heading(title_text, level=1)

    if resume.summary:
        add_section("Summary")
        document.add_paragraph(resume.summary)

    if resume.skills:
        add_section("Skills")
        document.add_paragraph(", ".join(resume.skills))

    if resume.experience:
        add_section("Experience")
        for exp in resume.experience:
            header = " — ".join(p for p in [exp.title, exp.company] if p)
            dates = " – ".join(p for p in [exp.start_date, exp.end_date] if p)
            line = header + (f" ({dates})" if dates else "")
            if exp.location:
                line += f", {exp.location}"
            heading_para = document.add_paragraph()
            run = heading_para.add_run(line)
            run.bold = True
            for bullet in exp.bullets:
                document.add_paragraph(bullet, style="List Bullet")

    if resume.projects:
        add_section("Projects")
        for proj in resume.projects:
            header = proj.name or "Project"
            if proj.technologies:
                header += f" ({', '.join(proj.technologies)})"
            heading_para = document.add_paragraph()
            run = heading_para.add_run(header)
            run.bold = True
            if proj.description:
                document.add_paragraph(proj.description)
            for bullet in proj.bullets:
                document.add_paragraph(bullet, style="List Bullet")

    if resume.education:
        add_section("Education")
        for edu in resume.education:
            header = " — ".join(p for p in [edu.degree, edu.institution] if p)
            dates = " – ".join(p for p in [edu.start_date, edu.end_date] if p)
            line = header + (f" ({dates})" if dates else "")
            if edu.field:
                line += f", {edu.field}"
            document.add_paragraph(line)

    if resume.certifications:
        add_section("Certifications")
        for cert in resume.certifications:
            document.add_paragraph(cert, style="List Bullet")

    if resume.achievements:
        add_section("Achievements")
        for ach in resume.achievements:
            document.add_paragraph(ach, style="List Bullet")

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()
