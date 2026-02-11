# Segurança

Este projeto roda no seu PC e executa ações locais (música, comandos no Minecraft, etc). Trate isso como um “controle remoto” do seu computador.

## Recomendação padrão (mais segura)

- `HOST=127.0.0.1` (não exponha a porta 3000 na LAN)
- Exponha o webhook **somente** via túnel (ngrok/Cloudflare Tunnel)
- Configure `WEBHOOK_SECRET` (token forte)
- Mantenha `urlWhitelist` restrita (YouTube por padrão)
- Use `cooldowns` para reduzir spam

## Ameaças comuns e como mitigar

### 1) Pessoas tentando chamar seu webhook

Mitigação:

- `WEBHOOK_SECRET` (obrigatório)
- Rate limit (`WEBHOOK_RATE_LIMIT_*`)
- Host local (`HOST=127.0.0.1`)

### 2) Links maliciosos enviados por doadores

Mitigação:

- O sistema só considera URL se o host estiver em `urlWhitelist`
- Evite habilitar ações do tipo `system.openUrl` se você não confia totalmente no modelo

### 3) Travar Minecraft com spam de mobs/comandos

Mitigação:

- `cooldowns.minecraft.rcon` e `cooldowns.minecraft.rconMulti`
- Limites em `minecraft.rconMulti` (`count` é limitado no código)

### 4) Vazamento de tokens do LivePix

Mitigação:

- Nunca commitar `.env` (já está no `.gitignore`)
- Prefira `LIVEPIX_CLIENT_ID` + `LIVEPIX_CLIENT_SECRET` em vez de colar access token manualmente

## Princípios

- Menos superfície: mantenha o servidor local, abra apenas via túnel
- Menos poder: habilite só as ações que você realmente quer
- Validação forte: whitelist de URL e tokens sempre

