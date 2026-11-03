# Ailo

Eén rustige werkplek (interface in het Engels) voor meerdere AI-codeassistenten (OpenAI Codex en Claude Code) en meerdere accounts per aanbieder. Elk gesprek hoort bij precies één account, en gesprekken met verschillende accounts lopen gelijktijdig, zonder uit en in te loggen.

Zie [docs/haalbaarheid.md](docs/haalbaarheid.md) voor het onderzoek: wat geverifieerd is en wat nog een aanname is.

## Vereisten

- Windows 10/11; de broncode wordt ook op Linux gebouwd en getest. Desktopintegratie en login zijn op Linux en macOS nog niet op een echte desktop gevalideerd.
- Node.js 24 of nieuwer, inclusief npm (met nvm: `nvm use`)
- Minstens één CLI: `npm install -g @openai/codex` en/of [Claude Code](https://code.claude.com/docs/en/setup)
- Windows-projecten die moderne PowerShell/.NET-functies gebruiken hebben PowerShell 7 nodig. Ailo zoekt ook in de gebruikelijke PowerShell 7-installatiemappen en geeft die alleen aan de eigen processen door.

## Starten

Kloon de uitgebrachte versie van `master` en installeer de vastgelegde dependencies:

```sh
git clone --branch master https://github.com/fortunium/Ailo.git
cd Ailo
npm ci
npm run dev
```

`npm run dev` bouwt de app en opent het venster. Voeg bij de eerste start je eigen
AI-account toe via **Accounts** en meld je zelf aan. Er is geen `.env`-bestand of
API-sleutel nodig om de app te openen. Ailo levert geen abonnement of tegoed mee.
Installeer een ontbrekende provider-CLI zoals hierboven aangegeven en herstart Ailo.
`npm ci` haalt ook de Electron-runtime op; daarvoor is internet nodig. De
startcommando's controleren deze installatie opnieuw en gebruiken de lokale kopie
zodra die beschikbaar is.

Voor normaal lokaal gebruik met een productiebuild:

```sh
npm run release
```

Dit bouwt de app in `out/` en start die vervolgens. `npm start` doet hetzelfde.
`npm run build` bouwt zonder een venster te openen; `npm test` draait de standaardtests
zonder modelaanvragen. Voor ontwikkeling kun je `develop` klonen; zie
[CONTRIBUTING.md](CONTRIBUTING.md).

Gegevens staan buiten de repository in `%APPDATA%\Ailo\data` (te overschrijven met
`AILO_DATA_DIR`). Iedere gebruiker begint met eigen lokale gegevens; accounts en
gesprekken van de maker staan niet in de repository of release. Een andere CLI
kies je met `AILO_CODEX_PATH` of `AILO_CLAUDE_PATH`.

Gebruik op Linux een grafische desktopsessie. Voor versleutelde MCP-credentials
is een ontgrendelde OS-keyring nodig, zoals GNOME Keyring of KWallet. Git is nodig
voor automations met een eigen worktree. MCP-servers kunnen extra runtimes vereisen.

## Pakketten delen (Windows en Linux, x64)

De packagingconfiguratie is voorbereid. Voorlopig ontwikkelen en gebruiken we
Ailo via `npm run dev`; de Linux-pakketten zijn nog niet gevalideerd.
De GitHub-release **v0.1.0** bevat de broncode. Start deze met de commando's hierboven.

De pakketten bevatten Electron en de productiecode. Gebruikers installeren hun
eigen Codex/Claude CLI en melden zich zelf aan. Accountmappen, gesprekken,
ontwikkelscripts en de native Claude SDK-binaries worden niet meegeleverd.
Zie [INSTALL.md](docs/INSTALL.md) voor de instructies voor ontvangers.

```sh
npm ci
npm run dist:win    # op Windows: installer in dist/
npm run dist:linux  # op Linux: AppImage en tar.gz in dist/
```

Op Windows kun je de Linux-pakketten via Docker Desktop bouwen:

```powershell
docker build -f build/Dockerfile.linux -t ailo-packager:0.1.0 .
docker create --name ailo-package-export ailo-packager:0.1.0
docker cp ailo-package-export:/project/dist/. ./dist/
docker rm ailo-package-export
node scripts/checksums.mjs
```

De Docker-build doet ook een opstartcontrole met Xvfb en een lege gegevensmap.
De Chromium-sandbox staat alleen in die rootcontainer-test uit; het gedeelde
pakket gebruikt de normale sandbox. Controleer de desktopwerking ook op de
Linux-distributie van de ontvanger, met name keyring, login en CLI-detectie.
`node scripts/smoke-package.mjs dist/win-unpacked/Ailo.exe` controleert de
Windows-build zonder bestaande accounts te gebruiken of modelaanvragen te doen.

De GitHub Actions-workflow **Build desktop packages** bouwt op Windows en
Ubuntu bij handmatig starten. Downloads zijn workflow-artifacts;
er wordt geen release gepubliceerd. `SHA256SUMS.txt` bevat de checksums.
De eerste testpakketten zijn niet ondertekend en updates zijn handmatig.

## Sneltoetsen

| Toets | Actie |
|---|---|
| Ctrl+N | Nieuw gesprek |
| Ctrl+K | Gesprek zoeken |
| Ctrl+, | Accounts |
| Enter / Shift+Enter | Versturen / nieuwe regel |
| Esc (in het invoerveld) | Lopende uitvoering stoppen |
| y / a / n (terminal, bij een toestemmingsverzoek) | Toestaan / voor deze sessie / weigeren |
| F2 | Gesprek hernoemen |
| Alt+↑ / Alt+↓ | Vorig / volgend gesprek |

## Terminal, bijlagen en losse gesprekken

Ailo gebruikt uitsluitend de terminalweergave. De invoer ondersteunt meerdere regels, lange plaktekst (inklapbaar zonder tekst te verliezen), geplakte afbeeldingen en gesleepte of gekozen bestanden. Niet-verstuurde tekst en bijlagen blijven bewaard bij het wisselen tussen gesprekken zolang de app open is. Maximaal 10 bijlagen per bericht, 20 MB per bestand en 5 MB per afbeelding (PNG, JPEG, GIF of WebP). Afbeeldingen gaan als beeldinvoer naar het model; andere bestanden worden als lokale kopie beschikbaar gemaakt.

**New conversation** en Ctrl+N beginnen standaard een los gesprek in een nieuwe lege map. In het dialoogvenster kun je een eigen map of bestaand project kiezen. De plusknop bij een project selecteert dat project vooraf. Losse gesprekken staan apart in de zijbalk.

**Delete** verwijdert een gesprek met zijn transcript en bijlagen. Stop een lopend gesprek eerst. Werkbestanden blijven staan, ook in de automatisch gemaakte losse werkmap. Voor Codex verwijdert Ailo ook de providersessie wanneer de CLI dat ondersteunt; bij Claude blijft de eigen CLI-geschiedenis staan. Een melding geeft aan wanneer alleen de Ailo-kopie is verwijderd.

## Gebruik en modelinstellingen

Eigen berichten hebben in beide thema's een aparte achtergrond, accentstrook en
**You**-label, zodat de vraag duidelijk losstaat van het antwoord.

Lokale bestandslinks in antwoorden openen een voorbeeld in Ailo. Tekst en code
uit de werkmappen of bijlagen van het gesprek worden alleen gelezen; scripts
worden niet uitgevoerd. **Show in folder** toont het bestand in de bestandsbeheerder.
Voor grote of binaire bestanden is de mapactie beschikbaar. Ontbrekende bestanden
en paden buiten de gespreksmappen geven een melding. Weblinks openen in de browser.

Tijdens een beurt toont een activiteitenbalk de actieve commando's, tools en
bestandswijzigingen. Codex-commandoutput en beschikbare voortgangsberichten
worden direct bijgewerkt. Claude toont toolaanroepen al tijdens het opbouwen
en meldt voortgang en achtergrondtaken wanneer de SDK die doorgeeft. Alleen
door de provider gepubliceerde samenvattingen worden weergegeven.

Een commando neemt standaard één uitklapbare regel in met een statusicoon en de
actienaam. De volledige opdracht, exitcode, meldingen en uitvoer staan binnen het
uitklapvak, ook bij commando's zonder uitvoer. Andere tooloutput is ingeklapt
achter **Output**, met het aantal regels en een live-indicator. De gekozen stand
blijft behouden tijdens live updates. Een waarschuwing of fout blijft herkenbaar
aan het statusicoon.

Opeenvolgende commando's, zoekacties en voortgangsnotities staan samen achter
één compacte actieregel. De samenvatting telt acties, waarschuwingen, fouten en
gestopte acties; tijdens een beurt is ook de huidige actieve actie zichtbaar.
Klap de groep open om individuele details te bekijken. Antwoorden, wijzigingen,
vragen en toestemmingsverzoeken blijven rechtstreeks in het gesprek staan.

Bij een toestemmingsverzoek blijft de vraag met de bestaande knoppen zichtbaar;
alleen de technische opdracht staat ingeklapt. De toetsen `Y`, `A` en `N` werken
voor het eerste actieve verzoek buiten tekstvelden. Tijdens typen, toetsherhaling
of een open dialoog worden ze niet als toestemming verwerkt. Een provider kan
goedkeuren via één toets uitsluiten; de knoppen blijven dan beschikbaar.

Uitgeklapte commandotekst en uitvoer gebruiken de gewone gespreksbalk voor
verticaal scrollen. Nieuwe tekst volgt automatisch zolang je onderaan blijft;
omhoog scrollen laat je leespositie intact.

Een vraag die door een fout vóór aflevering niet bij de provider aankwam, blijft
lokaal als **not yet delivered** staan. Bij je volgende bericht gaan die eerdere
vragen en bijlagen mee, ook na een herstart. Een sessie-ID alleen geldt niet als
bewijs dat een vraag is ontvangen. Bekende oudere Codex-pluginstartfouten worden
ook herkend, zodat de oorspronkelijke vraag alsnog beschikbaar komt.

Gestopte acties tonen **Stopped · no final result**. Bij afgeronde commando's
is de exitcode zichtbaar wanneer de provider die doorgeeft. Bekende foutmeldingen
en buildwaarschuwingen in de uitvoer krijgen een aparte melding; een exitcode 0
is bij gecombineerde PowerShell-opdrachten geen bewijs dat alle deelopdrachten
zijn geslaagd. Deze herkenning is een aanwijzing om de uitvoer te controleren,
geen volledige analyse van alle mogelijke toolmeldingen.

Accounts en de gespreksvoet tonen het abonnementsgebruik van het betreffende account, met resetmomenten en het tijdstip van de laatste meting. Ze verversen bij starten, na een beurt, elke minuut zolang ze zichtbaar zijn, en met **Refresh usage**. Ontbrekende cijfers worden als niet beschikbaar getoond. Claude biedt deze gegevens via een experimenteel SDK-endpoint; dat staat bij de meter. Het contextgebruik van het gesprek wordt afzonderlijk getoond na modelaanvragen.

Onder het gesprek kies je **Model**, **Reasoning** en **Speed**, op basis van de catalogus van de gekoppelde CLI. Instellingen blijven per gesprek bewaard en gelden vanaf de volgende beurt; wijzigen tijdens een lopende beurt is geblokkeerd. Een catalogus is geen garantie dat je abonnement elk model toestaat. Fast gebruikt bij Codex 2,5x de inbegrepen abonnementsruimte, en gekochte credits kosten 2x standaard. Zie de officiele [Speed-documentatie](https://learn.chatgpt.com/docs/agent-configuration/speed) en het [App Server-protocol](https://learn.chatgpt.com/docs/app-server).

## Automations en integraties

**Automations** in de zijbalk bevat herbruikbare taken en hun resultaten. Begin met een template of eigen instructies, kies expliciet een AI-account, project/map, modelinstellingen en tools, en sla de taak op. **Run now** voert de opgeslagen taak uit. Een planning kan dagelijks, op werkdagen of wekelijks worden ingesteld, met een eigen IANA-tijdzone (bijvoorbeeld `Europe/Amsterdam`). Een planning staat pas aan na **Enable this schedule** en opslaan.

Elke uitvoering krijgt een nieuw gesprek en een vastgelegde taakdefinitie en toolselectie. Resultaten tonen Starting, Running, Needs attention, Completed, Failed, Blocked, Interrupted of Missed. Via **Open conversation** bekijk je de uitvoer, beantwoord je vragen en geef of weiger je toestemming. De tijdslimiet stopt een lopende beurt. Er lopen geen twee uitvoeringen van dezelfde taak tegelijk, en Ailo wisselt bij een loginprobleem of usage-limiet nooit naar een ander account.

De scheduler werkt zolang Ailo openstaat, ook geminimaliseerd. Sluiten stopt de app en haar uitvoeringen; er is nog geen los achtergrondproces. Na slaapstand of een herstart worden verouderde planningsmomenten als gemist geregistreerd, zonder een achterstand aan modelaanvragen uit te voeren. Met Run again start je bewust een nieuwe uitvoering. Taken en resultaten blijven na een herstart bewaard.

Uitvoeringsmodi:

- **Report only:** alleen ingebouwde lees- en zoekmogelijkheden. Codex gebruikt een read-only sandbox; Claude krijgt een beperkte toolset. MCP's en plugins staan in deze modus uit. Een rapporttaak kan dus niet zelf een test- of buildshell starten.
- **Dedicated Git worktree:** een eigen branch en werkmap vanaf de gecommitte HEAD. Niet-gecommitte bestanden worden niet gekopieerd. Worktrees en gegenereerd werk blijven beschikbaar voor beoordeling; Ailo commit of verwijdert ze niet automatisch.
- **Working folder:** werken in de gekozen map, met de normale toestemmingen van de provider. Overlappende actieve werkmappen blokkeren een automation; kies Run again zodra de map vrij is of gebruik een worktree.

**Integrations** heeft drie tabbladen:

- **MCP connections:** STDIO-processen en Streamable HTTP, met afzonderlijke externe identiteitslabels, providercompatibiliteit en optionele toolnamen om toegang te beperken. Test connection ontdekt beschikbare tools zonder een modelaanvraag. OAuth gebruikt een lokale callback, state en PKCE; services moeten de bijbehorende discovery/registratie ondersteunen. Tokens worden automatisch ververst waar de service dat ondersteunt. Voor diensten met afwijkende of vooraf geregistreerde OAuth-clients is verdere configuratie nodig; bearer tokens, headers en proces-env kunnen ook worden opgegeven.
- **Skills:** herbruikbare instructies die in een nieuw gesprek worden vastgelegd. Het bewerken van de bibliotheek wijzigt geen lopend gesprek.
- **Local plugins:** importeer een beoordeelde pluginmap met een manifest. Ailo bewaart een eigen kopie met versie en inhoudshash. Claude gebruikt de SDK-pluginloader; Codex gebruikt de officiele CLI met een lokale Ailo-marketplace binnen het account. Er is nog geen marketplace-browser. Extra native vereisten, zoals Codex-toestemming voor pluginhooks, blijven gelden.

Credentials uit het credentialsveld worden via Electron safeStorage versleuteld met de OS-opslag; er is geen plaintext fallback. Windows gebruikt DPAPI. Project- en statebestanden bevatten alleen een verwijzing. HTTP buiten localhost vereist HTTPS. Stop tokens niet in URL's, commandoregelargumenten of skillinstructies. Het externe dienstaccount is onafhankelijk van het AI-account. Als je credentials vervangt of wist, moet een bestaand gesprek een nieuwe toolselectie in een nieuw gesprek krijgen; tokenverversing binnen dezelfde OAuth-login behoudt de verbinding.

Selecteer tools bij **New conversation**, via **Tools** voor de eerste beurt, in de projectinstellingen als standaard, of per automation. De selectie en versies blijven gedurende een gesprek vast. MCP-configuraties worden niet in je globale Codex- of Claude-profiel geschreven. Codex gebruikt afzonderlijke processen per account en toolprofiel; Claude ontvangt expliciete server- en pluginconfiguratie. Lokale plugins kunnen uitvoerbare scripts bevatten: importeren kopieert bestanden, activeren laat de provider ze laden.

Aanvullende tests zonder modelaanvragen:

```powershell
$env:AILO_IT_CODEX = "1"
$env:AILO_IT_CLAUDE_CONFIG = "1"
npm test
```

Deze configuratietests gebruiken lege tijdelijke accountmappen en controleren echte MCP-processen en lokale plugins. De tests met echte Claude-antwoorden vereisen afzonderlijk `AILO_IT_CLAUDE_HOME`.

## Accountisolatie bewijzen met twee eigen accounts

Voer alle commando's uit vanuit de map waarin je deze repository hebt gekloond.

1. Start Ailo en open **Accounts** (Ctrl+,).
2. Voeg twee accounts van dezelfde aanbieder toe, bijvoorbeeld *OpenAI privé* en *OpenAI opdrachtgever*. Voor een tweede account biedt Ailo een link om in een privevenster te openen.
   - Meld je bij het tweede account aan met het **andere** account. Ben je in de browser al ingelogd met het eerste, gebruik dan een privévenster of log daar eerst uit. Anders koppel je per ongeluk twee keer dezelfde identiteit; Ailo toont het e-mailadres per account, zodat je dat ziet.
   - Codex-aanmeldingen lopen één voor één, omdat de browsercallback een vaste lokale poort gebruikt.
3. Sluit Ailo en voer uit:
   ```powershell
   npm run proof
   ```
   Het script voert met beide accounts **gelijktijdig** een gesprek. Daarna controleert het dat elk proces de eigen map gebruikt, dat sessies alleen in de eigen map staan, dat elk account het eigen gesprek onthoudt, dat het ene account de sessie van het andere niet kan openen, en dat beide identiteiten ongewijzigd zijn. Het script logt nooit in of uit en kopieert geen tokens.

## Opbouw

Zie [CONTRIBUTING.md](CONTRIBUTING.md) voor de Gitflow-afspraken met `master`,
`develop`, featurebranches, releases en hotfixes. De huidige ontwikkeling staat
op `develop`.

```
src/shared/types.ts         gedeelde types (IPC-contract)
src/main/env.ts             omgeving per account: één accountmap, alle andere identiteitsvariabelen eruit
src/main/cli.ts             CLI-detectie (lost de npm-shim van codex op naar codex.exe)
src/main/store.ts           lokale opslag (atomisch), herstel na een crash
src/main/service.ts         accounts, projecten, gesprekken, uitvoeringen; los van Electron
src/main/providers/codex.ts adapter voor codex app-server (één proces per account)
src/main/providers/claude.ts adapter voor de Claude Agent SDK
src/main/redact.ts          haalt geheimen uit logs
src/renderer/               React-interface
scripts/isolation-proof.mjs bewijs met echte accounts
```

## Bekende beperkingen (v0.1)

- Op Windows bewaart Claude Code de login als `.credentials.json` in de accountmap, beschermd door de rechten van je gebruikersprofiel. Codex gebruikt Windows Referentiebeheer. Ailo slaat zelf geen tokens op.
- MCP-elicitaties van Codex worden netjes geweigerd, met een melding.
- Een ander account gebruiken betekent een nieuw gesprek; de geschiedenis gaat niet automatisch mee.
- Persoonlijk gebruik: zie de opmerking over abonnementslogin in het haalbaarheidsrapport.
