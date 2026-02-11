# TopMusicaLivePix (Captando)

Automação local para streamers: receba doações do **LivePix** via webhook e transforme em ações no seu PC, com foco em **música (fila + VIP)**, **Minecraft (RCON)** e páginas prontas para **OBS**.

## O que este projeto faz

- Recebe eventos do LivePix em `POST /webhook/livepix`
- Aplica regras (valor, palavras-chave, URL, maior doação)
- Executa ações:
  - Música: fila e VIP (toca imediatamente) no player do YouTube
  - Minecraft: comandos via RCON
  - SFX: toca arquivos de áudio no overlay do OBS (opcional)
- Mostra um dashboard local para acompanhar tudo

## Páginas

- Dashboard: `http://127.0.0.1:3000/`
- Player (capturar no OBS): `http://127.0.0.1:3000/player`
- Overlay (capturar no OBS): `http://127.0.0.1:3000/overlay`

## Segurança (leia isto antes)

Este projeto foi pensado para rodar **somente no seu PC** com um túnel (ngrok ou Cloudflare Tunnel).

Recomendações obrigatórias:

- Use `HOST=127.0.0.1` (padrão)
- Configure um `WEBHOOK_SECRET` forte
- Use `urlWhitelist` (padrão: YouTube) para evitar abrir links perigosos
- Use `cooldowns` nas ações para não travar Minecraft / spam

Leia também: `SECURITY.md`.

## Requisitos

- Conta no LivePix (para configurar webhook)
- Node.js (LTS)
- Git (para clonar o projeto)
- Opcional:
  - Minecraft Java com **servidor dedicado** (RCON não existe no single player padrão)
  - Ngrok ou Cloudflare Tunnel para expor o webhook com segurança

Links oficiais:

- Node.js: https://nodejs.org/
- Git: https://git-scm.com/
- ngrok: https://ngrok.com/
- cloudflared (Cloudflare Tunnel): https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

## Instalação (passo a passo)

### Instalador Windows (mais facil)

Dentro do repositorio, rode:

- `scripts\\install-windows.bat` (duplo clique)
ou
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\install-windows.ps1`

O script tenta instalar `Git`, `Node.js LTS` e `ngrok` via `winget`, instala dependencias e cria o `.env` com `WEBHOOK_SECRET` gerado.

### Atualizar no Windows (baixar ultima versao)

Dentro do repositorio, rode:

- `scripts\\update-windows.bat` (duplo clique)
ou
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\update-windows.ps1`

Esse script faz `git fetch/pull` e depois `npm i`.

### 1) Instalar o Node.js (LTS)

Windows/macOS:

1. Baixe e instale o Node.js LTS no site oficial
2. Abra o terminal (PowerShell no Windows / Terminal no macOS)
3. Verifique:

```bash
node -v
npm -v
```

Linux:

- Recomendo usar `nvm` ou o gerenciador da sua distro, desde que seja uma versão recente do Node.

### 2) Clonar o projeto

```bash
git clone git@github.com:Captando/TopMusicaLivePix.git
cd TopMusicaLivePix
```

### 3) Instalar dependências

```bash
npm i
```

### 4) Configurar `.env`

Crie seu arquivo `.env` a partir do exemplo:

```bash
cp .env.example .env
```

Agora edite o `.env` e configure no mínimo:

- `WEBHOOK_SECRET` (obrigatório para segurança)
- `RCON_PASSWORD` (se for usar Minecraft)

Dica para gerar um token forte:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

### Variáveis do `.env` (referência rápida)

- `HOST`: IP/interface que o servidor vai escutar (padrão seguro: `127.0.0.1`)
- `PORT`: porta do servidor (padrão: `3000`)
- `WEBHOOK_SECRET`: token obrigatório para proteger o endpoint do webhook
- `WEBHOOK_RATE_LIMIT_WINDOW_MS` e `WEBHOOK_RATE_LIMIT_MAX`: limitador simples de requisições no webhook

LivePix (mapeamento do JSON do webhook, se necessário):

- `LIVEPIX_VALUE_PATH`: caminho do valor (dot-path). Ex: `data.amount`
- `LIVEPIX_MESSAGE_PATH`: caminho da mensagem. Ex: `data.message`
- `LIVEPIX_SENDER_PATH`: caminho do nome do doador. Ex: `data.tipper`
- `LIVEPIX_STATUS_PATH`: caminho do status. Ex: `data.status`
- `LIVEPIX_ACCEPTED_STATUSES`: lista de status aceitos (se `STATUS_PATH` estiver configurado)

LivePix API (só se o webhook vier em modo “Notificação Leve”, sem valor/mensagem):

- `LIVEPIX_ACCESS_TOKEN`: token (expira)
- `LIVEPIX_CLIENT_ID` e `LIVEPIX_CLIENT_SECRET`: credenciais (recomendado)
- `LIVEPIX_SCOPE`: escopos de leitura

Minecraft (RCON):

- `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD`

Música:

- `MUSIC_INTERRUPT_BEHAVIOR`: `drop` (padrão) ou `resume`

Regras:

- `RULES_PATH`: caminho do arquivo de regras (padrão: `config/rules.json`)

### 5) Rodar o servidor

Desenvolvimento (reinicia sozinho):

```bash
npm run dev
```

Produção:

```bash
npm start
```

## Configurar OBS (rápido)

1. Abra `http://127.0.0.1:3000/player` no seu navegador para validar que carrega
2. No OBS, adicione **Fonte -> Navegador**:
   - Para música: URL `http://127.0.0.1:3000/player`
   - Para overlay: URL `http://127.0.0.1:3000/overlay`
3. Para a música, habilite a opção do Browser Source que permite o áudio ser controlado pelo OBS (nome varia por versão)

Observação: algumas configurações do YouTube podem exigir interação inicial (abrir a página 1 vez) para permitir autoplay com áudio.

## Expor o webhook com segurança (ngrok)

### 1) Instalar e logar no ngrok

1. Crie uma conta no ngrok
2. Instale o ngrok
3. Configure seu authtoken (o ngrok mostra isso no painel):

```bash
ngrok config add-authtoken SEU_TOKEN_AQUI
```

### 2) Criar o túnel para a porta 3000

Com o servidor rodando:

```bash
ngrok http 3000
```

O ngrok vai mostrar uma URL pública (ex: `https://xxxx.ngrok-free.app`).

Sua URL final no LivePix fica assim:

```
https://xxxx.ngrok-free.app/webhook/livepix?token=SEU_WEBHOOK_SECRET
```

Nota: no plano gratuito do ngrok, essa URL muda quando você reinicia o ngrok.

## Alternativa (Cloudflare Tunnel)

Se você já usa Cloudflare e quer um caminho mais “estável”, o Cloudflare Tunnel pode ser melhor.

Atalho rápido (URL temporária):

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Para URL fixa, você vai precisar configurar um túnel “nomeado” e um hostname no seu domínio.

## Configurar o webhook no LivePix

No painel do LivePix:

1. Crie/configure um webhook apontando para a URL do seu túnel
2. Use o endpoint `/webhook/livepix`
3. Inclua o `token` com seu `WEBHOOK_SECRET`

### Se o webhook do LivePix vier em modo “Notificação Leve” (sem valor/mensagem)

O LivePix pode enviar no webhook apenas um gatilho com **ID do recurso**, sem trazer `valor/mensagem/nome` no payload.

Exemplo comum (variantes existem):

```json
{
  "eventId": "evt_123",
  "event": "new",
  "resource": { "id": "64f8a...e12", "type": "message" },
  "userId": "61021c..."
}
```

Nessa forma, o servidor precisa pegar `resource.id` e consultar a API do LivePix para obter os dados reais.

Você tem 2 opções no `.env`:

1. `LIVEPIX_ACCESS_TOKEN` (mais simples, mas expira)
2. `LIVEPIX_CLIENT_ID` + `LIVEPIX_CLIENT_SECRET` (o servidor faz client_credentials e renova)

Onde pegar:

- No LivePix, crie uma “Aplicação” nas configurações da sua conta
- Copie `client_id` e `client_secret`
- Garanta escopos de leitura (ex: `messages:read` e `subscriptions:read`)

Referência extra (opcional): `docs/livepix-api.postman_collection.json`.

Coleção Postman da API local: `docs/topmusicalivepix-local.postman_collection.json`.

## Minecraft (RCON)

RCON exige servidor dedicado (vanilla/paper/etc).

No `server.properties`:

- `enable-rcon=true`
- `rcon.password=<RCON_PASSWORD>`
- `rcon.port=25575`

No `.env`:

- `RCON_HOST=127.0.0.1`
- `RCON_PORT=25575`
- `RCON_PASSWORD=...`

## Regras (o “cérebro”)

Arquivo: `config/rules.json`

O motor de regras faz:

1. Lê a doação (valor, mensagem, remetente)
2. Extrai URL (se houver) e valida contra `urlWhitelist`
3. Decide ações por prioridade e por “canal” (ex: música VIP vence música fila)

### Condições suportadas (`when`)

- `minValue` (número)
- `hasUrl` (true/false)
- `keywordsAny` (array)
- `keywordsAll` (array)
- `regex` (string)
- `isNewTop` (true/false): dispara só quando vira a **maior doação** até agora

### Tipos de ação

- `music.playNow` (VIP)
- `music.enqueue` (fila)
- `minecraft.rcon`
- `minecraft.rconMulti`
- `system.openUrl` (abre a URL whitelisted no browser)
- `sfx.play` (toca um áudio no overlay, ex: `/sfx/susto.mp3`)

Para SFX:

1. Coloque seus arquivos em `public/sfx/` (mp3/wav)
2. Referencie no `config/rules.json` como `/sfx/seu-audio.mp3`

### Recarregar regras sem reiniciar

No dashboard: botão “reload rules”

Ou via API:

```bash
curl -X POST http://127.0.0.1:3000/api/rules/reload
```

## Teste rápido (sem LivePix)

```bash
./scripts/test-webhook.sh 25 "https://youtu.be/dQw4w9WgXcQ creeper" "Alice"
```

## Licença

MIT (veja `LICENSE`).

## Apoiar o Programador

Se esse projeto te ajudou e você quiser apoiar o desenvolvimento:

`https://livepix.gg/captando`
