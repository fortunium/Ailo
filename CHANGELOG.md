# Changelog

## Unreleased

- Bestaande MCP-verbindingen uit een Codex-account zijn zichtbaar in Integrations
  en selecteerbaar bij de gesprekstools, met behoud van de bestaande aanmelding.
- Herstel van `invalid transport` door onjuist gequote MCP-namen in
  Codex-configuratie-overrides.
- Tussentijdse antwoorden, correcties en bijlagen versturen tijdens een lopende
  Codex- of Claude-taak, met **Send** naast **Stop**.
- Bezorgstatus en herstel van nog niet verwerkte berichten, ook als een taak
  vlak voor het versturen eindigt.

## 0.2.0 - 2026-11-03

- Nieuw Ailo-appicoon voor het venster, de zijbalk, meldingen en pakketbestanden.
- Desktopmeldingen bij afgeronde of mislukte achtergrondtaken; aanklikken opent
  het juiste gesprek. Meldingen zijn via de belknop aan of uit te zetten.
- Ongelezen antwoorden met **New**, vetgedrukte titels en projecttellers.
  De markering blijft na een herstart bewaard tot je het gesprek bekijkt.
- Blijvende keuze **Permissions: Ask / Always allow** voor beide providers,
  inclusief lopende toestemmingsverzoeken. Inhoudelijke vragen blijven zichtbaar
  en de alleen-lezenmodus voor rapportages blijft behouden.
- Lokale bestandslinks openen een code- of tekstvoorbeeld met **Show in folder**.
  Ontbrekende bestanden geven een melding; toegang blijft binnen de gespreksmappen.
- Duidelijker onderscheid tussen prompts en antwoorden in licht en donker.
- Grotere statusicoontjes in de zijbalk (16 px) en drie rustig oplichtende stipjes
  tijdens het werken.

Breng deze versie na `npm ci` lokaal aan het werk met `npm run dev` of
`npm run release`. Bestaande gebruikers herstarten Ailo zodra hun lopende taak
klaar is, zodat ook de wijzigingen in het hoofdproces actief worden.

Dit is een broncoderelease; desktopinstallers zijn nog niet uitgebracht.

## 0.1.0 - 2026-11-03

Eerste broncoderelease van Ailo. Start na `npm ci` met `npm run dev` of
`npm run release` (productiebuild en lokaal starten). Node.js 24+ is vereist.

- Meerdere Codex- en Claude-accounts met een eigen accountmap per gesprek.
- Projecten en losse gesprekken, bijlagen, codeweergave en modelinstellingen.
- Gebruiksmeters, live acties en compacte uitklapbare commandodetails.
- Herstel van niet-afgeleverde vragen na een mislukte start.
- Leesbare toestemmingsverzoeken en sneltoetsen buiten tekstvelden.
- Eén gespreksbalk voor uitgeklapte uitvoer, met behoud van de leespositie.
- Automations, resultaten, skills, MCP-verbindingen en lokale plugins.
- Broncontroles op Windows en Linux; account- en providerconfiguratietests.

De release bevat geen accounts, credentials, gesprekken of desktopinstallers.
Gebruikers installeren hun eigen provider-CLI en koppelen hun eigen account.
Automations draaien alleen zolang Ailo open is. Linux-desktopintegratie en
aanmelden op Linux zijn nog niet op een echte desktop gevalideerd.
