# Changelog

Este projeto segue (aproximadamente) SemVer.

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
