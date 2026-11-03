# Ailo installeren (0.1, testversie)

Voor **v0.1.0** gebruik je de broncode met `npm ci` en `npm run dev`, of
`npm run release`. Zie [Starten in de README](../README.md#starten).
Onderstaande pakketinstructies zijn voorbereid voor toekomstige desktopdownloads.

## Windows (x64)

Open `Ailo-0.1.0-windows-x64-setup.exe`. Installatie kan voor je eigen gebruiker.
Deze testversie is niet digitaal ondertekend; Windows kan een melding over een
onbekende uitgever tonen. Download het pakket alleen rechtstreeks van de maker.

## Linux (x64)

Gebruik een recente desktopdistributie met glibc, bijvoorbeeld Ubuntu 24.04.

```sh
chmod +x Ailo-0.1.0-linux-x86_64.AppImage
./Ailo-0.1.0-linux-x86_64.AppImage
```

AppImage heeft FUSE 2 nodig (Ubuntu 24.04: `sudo apt install libfuse2t64`).
Als FUSE ontbreekt, gebruik het tar.gz-pakket:

```sh
mkdir -p ailo
tar -xzf Ailo-0.1.0-linux-x64.tar.gz -C ailo
cd ailo
./ailo
```

Het Chromium-sandboxbeleid verschilt per distributie. Als starten door het
sandboxbeleid wordt geweigerd, laat dit met de foutmelding aan de maker weten.
Schakel de sandbox niet standaard uit. Alpine/musl en ARM zijn geen targets
van deze eerste distributie.

Voor versleutelde MCP-credentials moet een ontgrendelde OS-keyring beschikbaar
zijn, bijvoorbeeld GNOME Keyring of KWallet. Ailo weigert credentials zonder
beveiligde opslag op te slaan.

## AI-assistenten en tools

Ailo bevat Electron en heeft zelf geen losse Node.js-installatie nodig.
De provider-CLI's zijn niet meegeleverd. Installeer minstens een van deze:

- Codex: volg https://developers.openai.com/codex/cli/.
  Installeren via npm (`npm install -g @openai/codex`) vereist Node.js.
- Claude Code: volg https://code.claude.com/docs/en/setup.
- Git is nodig voor Git-projecten en automations met een eigen worktree.
- MCP-servers en plugins kunnen aanvullende runtimes nodig hebben, zoals Node.js
  of Python. Installeer die zoals hun eigen documentatie aangeeft.

Herstart Ailo na installatie van een CLI. Linux-desktopstarters erven niet altijd
het PATH uit je shell; `~/.local/bin` en `~/.npm-global/bin` worden ook doorzocht.
Voor een afwijkende locatie kun je starten met bijvoorbeeld:

```sh
AILO_CODEX_PATH=/absoluut/pad/naar/codex ./ailo
AILO_CLAUDE_PATH=/absoluut/pad/naar/claude ./ailo
```

Open **Accounts**, voeg je eigen account toe en meld je zelf aan.
Je hebt een geschikte accounttoegang en toestemming van de aanbieder nodig;
Ailo levert geen abonnement of tegoed mee. Gebruik is onderworpen aan de actuele
voorwaarden van OpenAI en Anthropic.

## Gegevens en updates

Je eigen accounts, gesprekken en bestanden blijven lokaal:

- Windows: `%APPDATA%\Ailo\data`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/Ailo/data`

De download bevat geen accounts of gesprekken van de maker. Deel je eigen
gegevensmap niet met anderen. Verwijderen van de applicatie wist deze map niet.
Een portable AppImage gebruikt ook deze vaste gegevensmap.

Updates zijn handmatig: sluit Ailo en installeer/vervang het pakket. Automations
werken alleen zolang Ailo draait. Meld problemen met OS-versie, Ailo-versie en
foutmelding; stuur geen tokens of je accountmap mee.
