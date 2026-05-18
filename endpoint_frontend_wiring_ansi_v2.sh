#!/bin/bash
echo -e "\
\033[48;5;17m\033[38;5;255m Cloudflare Pages \033[0m
\033[48;5;17m\033[38;5;255m ├─ Pages Function Proxy (Bearer token injection, CORS, rate limit) \033[0m
\033[48;5;17m\033[38;5;255m └─ Dashboard index.html \033[0m
\033[48;5;22m\033[38;5;84m    ├─ Monitor Tab \033[0m
\033[48;5;22m\033[38;5;84m    │   ├─ 📊 SummaryCards (15s) → GET /summary \033[0m
\033[48;5;22m\033[38;5;84m    │   ├─ 📜 LiveWagerTicker (WS real‑time, fallback 5s) → WS /live-wagers + GET /bet-ticker-wagers \033[0m
\033[48;5;22m\033[38;5;84m    │   ├─ 👥 AgentPerformanceTable (15s) → GET /performance \033[0m
\033[48;5;22m\033[38;5;84m    │   ├─ ✅ GradedWagersTable (10s) → GET /graded-wagers \033[0m
\033[48;5;22m\033[38;5;84m    │   └─ 🔐 AuthorizationsGrid (30s) → GET /authorizations \033[0m
\033[48;5;53m\033[38;5;213m    ├─ Alerts Tab \033[0m
\033[48;5;53m\033[38;5;213m    │   ├─ ⚠️ AlertRulesForm → POST/PATCH/DELETE /alert-rules \033[0m
\033[48;5;53m\033[38;5;213m    │   ├─ ⚠️ AlertRulesList → GET /alert-rules \033[0m
\033[48;5;53m\033[38;5;213m    │   └─ 📋 AlertLogViewer (30s) → GET /alert-log \033[0m
\033[48;5;58m\033[38;5;220m    └─ 🟡 Toast + Connection + LastUpdate \033[0m
\033[0m

\033[48;5;17m\033[38;5;255m Worker (fantasy402-ingestion) \033[0m
\033[48;5;52m\033[38;5;208m ├─ Ingestion Engine \033[0m
\033[48;5;52m\033[38;5;208m │   ├─ 🕐 Cron (5min adaptive) \033[0m
\033[48;5;52m\033[38;5;208m │   ├─ 📦 Batch (POST /ingest/batch) \033[0m
\033[48;5;52m\033[38;5;208m │   └─ 🌐 Local (POST /ingest/local) \033[0m
\033[48;5;52m\033[38;5;208m ├─ Resilience Layer \033[0m
\033[48;5;52m\033[38;5;208m │   ├─ 🔴 Circuit Breaker (per endpoint, auto half‑open) \033[0m
\033[48;5;52m\033[38;5;208m │   ├─ 🆔 Idempotency (SHA‑256, INSERT OR IGNORE) \033[0m
\033[48;5;52m\033[38;5;208m │   └─ 🧱 Zod Validation (versioned schemas) \033[0m
\033[48;5;22m\033[38;5;84m ├─ Query Endpoints \033[0m
\033[48;5;22m\033[38;5;84m │   ├─ 📊 GET /summary \033[0m
\033[48;5;22m\033[38;5;84m │   ├─ 📈 GET /performance \033[0m
\033[48;5;22m\033[38;5;84m │   ├─ 🎯 GET /bet-ticker-wagers \033[0m
\033[48;5;22m\033[38;5;84m │   ├─ ✅ GET /graded-wagers \033[0m
\033[48;5;22m\033[38;5;84m │   ├─ 🏈 GET /prop-wagers \033[0m
\033[48;5;22m\033[38;5;84m │   ├─ 📍 GET /position-data \033[0m
\033[48;5;22m\033[38;5;84m │   ├─ 🔐 GET /authorizations \033[0m
\033[48;5;22m\033[38;5;84m │   ├─ ❤️ GET /health \033[0m
\033[48;5;22m\033[38;5;84m │   └─ 🔄 POST /replay \033[0m
\033[48;5;53m\033[38;5;213m ├─ Real‑time Layer \033[0m
\033[48;5;53m\033[38;5;213m │   ├─ 🌐 /live-wagers (WebSocket upgrade) → Durable Object \033[0m
\033[48;5;53m\033[38;5;213m │   └─ 📢 POST /broadcast (internal) \033[0m
\033[48;5;58m\033[38;5;220m ├─ Auth & Admin \033[0m
\033[48;5;58m\033[38;5;220m │   ├─ 🔑 POST /refresh-auth \033[0m
\033[48;5;58m\033[38;5;220m │   └─ 🛡️ Admin Agent Only (alert‑rule CRUD) \033[0m
\033[48;5;94m\033[38;5;180m ├─ Data Layer \033[0m
\033[48;5;94m\033[38;5;180m │   ├─ 💾 D1 (hot, covering indexes) \033[0m
\033[48;5;94m\033[38;5;180m │   ├─ 🗄️ R2 (Parquet archive >24h) \033[0m
\033[48;5;94m\033[38;5;180m │   └─ ⚡ KV (rate limiting) \033[0m
\033[0m

\033[48;5;17m\033[38;5;64m Upstream Fantasy402 API (86 endpoints) \033[0m
\033[48;5;17m\033[38;5;64m ← data fetched by Ingestion Engine \033[0m"
