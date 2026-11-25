"""Tests for the deterministic (non-LLM) part of resume parsing: raw text extraction from
PDF/DOCX. Fixtures are generated in-memory with reportlab/python-docx rather than committing
binary files.
"""

from __future__ import annotations

import io

import pytest

from app.services.resume_parser import ResumeParsingError, extract_raw_text


def _make_pdf_bytes(lines: list[str]) -> bytes:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)
    y = 750
    for line in lines:
        c.drawString(72, y, line)
        y -= 18
    c.save()
    return buffer.getvalue()


def _make_docx_bytes(paragraphs: list[str]) -> bytes:
    import docx

    document = docx.Document()
    for p in paragraphs:
        document.add_paragraph(p)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


RESUME_LINES = [
    "Jordan Rivera",
    "jordan.rivera@example.com | 555-123-4567",
    "Summary",
    "Backend engineer with 4 years of experience.",
    "Experience",
    "Software Engineer, Acme Corp, 2021-Present",
    "Built and shipped a Python/FastAPI microservice handling 2M requests/day.",
    "Education",
    "Bachelor of Science in Computer Science, State University",
]


def test_extract_raw_text_from_pdf():
    pdf_bytes = _make_pdf_bytes(RESUME_LINES)
    text = extract_raw_text(pdf_bytes, "pdf")
    assert "Jordan Rivera" in text
    assert "jordan.rivera@example.com" in text
    assert "Software Engineer" in text


def test_extract_raw_text_from_docx():
    docx_bytes = _make_docx_bytes(RESUME_LINES)
    text = extract_raw_text(docx_bytes, "docx")
    assert "Jordan Rivera" in text
    assert "Bachelor of Science" in text


def test_extract_raw_text_empty_file_raises():
    with pytest.raises(ResumeParsingError):
        extract_raw_text(b"", "pdf")


def test_extract_raw_text_unsupported_type_raises():
    with pytest.raises(ResumeParsingError):
        extract_raw_text(b"some bytes", "txt")


def test_extract_raw_text_corrupt_pdf_raises():
    with pytest.raises(ResumeParsingError):
        extract_raw_text(b"%PDF-1.4 not a real pdf structure at all", "pdf")


def test_extract_raw_text_corrupt_docx_raises():
    with pytest.raises(ResumeParsingError):
        extract_raw_text(b"not a real docx zip content", "docx")


def test_extract_raw_text_pdf_with_no_text_layer_raises():
    # A PDF with a blank page (no text) should be treated as unparseable.
    pdf_bytes = _make_pdf_bytes([])
    with pytest.raises(ResumeParsingError):
        extract_raw_text(pdf_bytes, "pdf")
