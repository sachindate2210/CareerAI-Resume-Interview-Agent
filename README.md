# 🚀 CareerAI: AI Resume & Interview Agent

An AI-native career platform: **resume parsing → analysis → job matching → skill-gap analysis → ATS scoring → tailored resume generation → adaptive AI mock interviews → evaluation → personalised improvement plan**.

![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-1C3C3C?style=flat-square&logo=langgraph&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-1C3C3C?style=flat-square&logo=langchain&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL%20%2B%20pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

## ✨ What it does
| Module | Description |
|---|---|
| **Resume analysis** | Parses PDF/DOCX resumes into structured data and scores them (ATS readiness, impact, clarity) |
| **Job analysis & matching** | Extracts requirements from a job description and matches the resume using embeddings (pgvector) + rules |
| **Skill-gap & learning plan** | Lists missing skills and builds a personalised improvement plan |
| **Resume optimizer** | Rewrites bullets for a target job and exports a tailored resume |
| **AI mock interview** | Adaptive interviewer built as a **LangGraph state machine**: follow-ups, difficulty adjustment, memory |
| **Interview evaluation** | Scores each answer with a rubric and gives feedback and model answers |
| **Admin** | Model/provider settings and branding |

## 🏗️ Architecture
```
Next.js 14 frontend (dashboard, upload, interview UI)
        │ REST + WebSocket
FastAPI backend (async, Pydantic v2, JWT auth, rate limiting)
        ├── agents/    resume_analyzer · job_analyzer · resume_optimizer · interviewer · interview_graph · interview_evaluator
        ├── services/  resume_parser · matching_engine · skill_gap · rag · report_pdf · storage
        └── PostgreSQL 16 + pgvector (data + embeddings) · Redis (cache, rate limits)
LLM provider is pluggable (Anthropic, OpenAI, Groq, Gemini, OpenRouter) behind app/core/llm.py
```
Full design notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API reference: [docs/API.md](docs/API.md)

## 🚀 Run locally
```bash
# 1. Database + Redis
docker compose up -d postgres redis

# 2. Backend
cd backend
python -m venv .venv
.venv\Scripts\activate             # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env             # add one LLM provider key
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 3. Frontend (new terminal)
cd frontend
npm install
copy .env.example .env.local
npm run dev                        # http://localhost:3000
```

## 🧪 Tests
```bash
cd backend
pytest                             # unit + API tests, plus golden-set evals in tests/eval
```

---
Built by **[Sunil Date](https://github.com/sachindate2210)** · [Portfolio](https://sunil-date-portfolio.vercel.app)
