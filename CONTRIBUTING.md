# Ontwikkelen

Gebruik Node.js 24, `npm ci` en `npm run dev`.
Controleer wijzigingen met `npm run typecheck`, `npm test` en `npm run build`.
De standaardtests doen geen modelaanvragen. Tests met echte accounts moeten
bewust worden ingeschakeld; lees daarvoor de README.

## Branches (Gitflow)

- `develop` is de standaardbranch voor de huidige ontwikkeling.
- `master` bevat uitsluitend uitgebrachte versies. Deze begint met een lege
  initialisatiecommit; de eerste versie staat voorlopig op `develop`.
- Begin nieuw werk op `feature/<naam>` vanaf `develop` en open een pull request
  naar `develop`.
- Bereid een versie voor op `release/<versie>` vanaf `develop`. Merge de release
  naar `master`, plaats daar een versietag en merge de release terug naar `develop`.
- Begin een dringende productiefix op `hotfix/<naam>` vanaf `master` en merge deze
  naar zowel `master` als `develop`.

De broncontroles draaien op Windows en Linux. Pakketten bouwen is voorlopig
uitsluitend handmatig via de afzonderlijke workflow; er wordt niets gepubliceerd.

## Geen persoonlijke gegevens committen

Bewaar accounts, transcripties, tokens en lokale experimenten buiten Git.
`.probe/`, `.env*`, `data/`, `secrets/`, provider-loginbestanden en buildresultaten
worden genegeerd. Controleer ook documentatie, schermafbeeldingen en testfixtures
voordat je een pull request maakt. Gebruik uitsluitend kunstmatige credentials
in tests.
