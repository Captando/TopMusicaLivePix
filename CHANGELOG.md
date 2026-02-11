# Changelog

Este projeto segue (aproximadamente) SemVer.

## v1.3.0 (2026-02-11)

- Auditoria local persistente (`ndjson`) com eventos de doação, ações e erros
- Endpoints novos:
  - `GET /api/audit`
  - `GET /api/reports/summary`
  - `GET /api/reports/top-senders`
  - `GET /api/moderation`
  - `POST /api/moderation/senders/block|unblock`
  - `POST /api/moderation/keywords/block|unblock`
- Moderação local por nome e palavra-chave com persistência em arquivo (`MODERATION_PATH`)
- Dashboard com painel de resumo, últimos eventos e controles de moderação
- Novas variáveis de ambiente para armazenamento local (`DATA_DIR`, `AUDIT_LOG_PATH`, `AUDIT_MAX_EVENTS`, `MODERATION_PATH`)

## v1.2.0 (2026-02-11)

- Nova ação `webhook.request` para enviar POST JSON para webhook personalizado de acordo com a doação
- Templates de payload/headers (`{{sender}}`, `{{value}}`, `{{valueBRL}}`, `{{message}}`, etc.)
- Controle de segurança por host permitido (`OUT_WEBHOOK_ALLOW_HOSTS`) e timeout (`OUT_WEBHOOK_TIMEOUT_MS`)

## v1.1.0 (2026-02-11)

- Integração com OBS WebSocket (trocar de cena, habilitar/desabilitar fonte, atualizar texto, reiniciar Media Source)

## v1.0.1 (2026-02-11)

- Dashboard agora compara versão pelo `package.json` remoto (evita falso "update disponível" por commit de merge)

## v1.0.0 (2026-02-11)

Primeira release estável.

- Webhook LivePix (`/webhook/livepix`) com token (`WEBHOOK_SECRET`) e rate limit
- Suporte ao modo "Notificação Leve" (payload com `resource.id` / `resource.type`) + fetch na API (OAuth client_credentials)
- Motor de regras em `config/rules.json` (prioridade, cooldown, whitelist de URL, `isNewTop`)
- Música (fila + VIP) via Player YouTube (`/player`) + Dashboard (`/`) + Overlay (`/overlay`)
- Minecraft via RCON (`minecraft.rcon` / `minecraft.rconMulti`)
- Scripts Windows: instalar (`scripts/install-windows.*`) e atualizar (`scripts/update-windows.*`)
- Coleção Postman da API local em `docs/topmusicalivepix-local.postman_collection.json`
