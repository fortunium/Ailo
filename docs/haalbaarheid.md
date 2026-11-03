# Haalbaarheid: meerdere accounts per aanbieder

Onderzocht op 2 november 2026, op Windows 11 met codex-cli 0.166.0, Claude Code 2.1.314 en Claude Agent SDK 0.3.316.

Legenda: **[G]** geverifieerd (documentatie gelezen én lokaal getest), **[D]** alleen in officiële documentatie, **[A]** aanname.

## 1. Aansturing

| | OpenAI Codex | Claude Code |
|---|---|---|
| Interface | `codex app-server`: JSON-RPC over stdio (JSONL) **[G]** | Claude Agent SDK (TypeScript) die het `claude`-binary aanstuurt **[G]** |
| Types | `codex app-server generate-ts` genereert de protocoltypes voor de geïnstalleerde versie **[G]** | `sdk.d.ts` in het npm-pakket **[G]** |
| Streaming | `item/agentMessage/delta`, `item/started`/`item/completed` en `turn/completed` **[G]** | `includePartialMessages` → `stream_event` met tekstdelta's **[G]** |
| Hervatten | `thread/resume { threadId }` **[G]**, ook na een herstart van de app | `resume: sessionId` **[G]**, ook na een herstart van de app |
| Stoppen | `turn/interrupt` **[G]**: binnen 30 ms onderbroken tijdens het streamen | `query.interrupt()` met `AbortController` als terugval **[G]** |
| Toestemming | Serververzoeken `item/commandExecution/requestApproval` en `item/fileChange/requestApproval` → `accept`/`acceptForSession`/`decline`/`cancel` **[G]** (types) | `canUseTool`-callback → `allow`/`deny`; `AskUserQuestion` via dezelfde callback **[G]** |
| Meerdere mappen | `sandbox_workspace_write.writable_roots` via `config` bij `thread/start` **[A]**: het config-pad komt uit `config.toml`, maar is niet getest | `additionalDirectories` (`--add-dir`) **[D]** |

Valkuilen die tijdens het onderzoek naar boven kwamen:

- Zonder expliciete `permissionMode` kan Claude Code in `auto` starten, waarin een classifier acties goedkeurt. Ailo geeft altijd `default` mee **[D]**.
- Een niet-ingelogde Claude-run geeft `result` met subtype `success` maar `is_error: true`. Kijk dus naar `is_error` **[G]**.
- Een niet-ingelogde Codex-home herhaalt tien keer een 401. Ailo controleert daarom vóór elke beurt `account/read` **[G]**.
- `codex` is op Windows een npm-`.cmd`-shim. Ailo start het echte `codex.exe`, zodat stoppen het juiste proces raakt **[G]**.
- De Windows-sandbox van Codex wordt per `CODEX_HOME` ingericht. Een nieuw account staat op `notConfigured`, en Ailo richt hem eenmalig in (`unelevated`) **[G]**.
- Als Ailo hard wordt beëindigd, stoppen `claude.exe` en `codex app-server` vanzelf, omdat stdin sluit **[G]**. Langlopende commando's die de agent zelf startte, kunnen wel blijven doorlopen **[A]**.

## 2. Meerdere accounts naast elkaar

| | OpenAI Codex | Claude Code |
|---|---|---|
| Scheiding | Eén `CODEX_HOME` per account **[G]** | Eén `CLAUDE_CONFIG_DIR` per account: officieel gedocumenteerd voor meerdere accounts **[D][G]** |
| Opslag van geheimen | `cli_auth_credentials_store = "keyring"` → versleuteld bestand `secrets/codex_auth.age`, sleutel in Windows Referentiebeheer als `secrets\|<hash>.codex`, één item per home **[G]** | Windows: `.credentials.json` in de accountmap (platte tekst, beschermd door de ACL van je gebruikersprofiel). macOS: Keychain, per map gesleuteld **[D][G]** |
| Isolatiecontrole in Ailo | `initialize` geeft `codexHome` terug; Ailo stopt als die niet klopt **[G]** | `system:init.apiKeySource` moet `none` zijn en `accountInfo().email` moet het gekoppelde e-mailadres zijn **[G]** |
| Geen terugval | Een lege home is "Not logged in" en valt niet terug op `~/.codex` **[G]** | Een lege map is "Not logged in" en valt niet terug **[G]** |
| Aanmelden vanuit Ailo | `account/login/start {type:"chatgpt"}` → `authUrl` → `account/login/completed` **[G]** (start en annuleren) | `claude auth login --claudeai` werkt zonder terminal: opent de browser, print de URL en accepteert een geplakte code op stdin **[G]** |

Wat per account gescheiden blijft: inloggegevens, `config.toml` en `settings.json`, sessie- en transcriptbestanden (`sessions/` en `projects/`), geschiedenis, plugins en MCP-configuratie, en de Codex-sandboxinrichting. Projectbestanden (`.claude/`, `AGENTS.md`, `CLAUDE.md`) in de werkmap worden bewust gedeeld: ze horen bij het project, niet bij het account.

Ailo bouwt de omgeving per proces opnieuw op en verwijdert alle `ANTHROPIC_*`, `CLAUDE*`, `CODEX_*` en `OPENAI_*`-variabelen. Zo kan een globale API-sleutel nooit stilzwijgend een ander account kiezen **[G]** (unit-test en run).

Bekende uitzondering: twee Claude **Console**-aanmeldingen zonder API-sleutel worden buiten de configmap opgeslagen en dus niet gescheiden **[D]**. Ailo gebruikt alleen `--claudeai` (abonnement).

## 3. Abonnement in plaats van API

- **Codex:** "Sign in with ChatGPT" gebruikt het tegoed van je ChatGPT-plan. Een API-sleutel wordt los gefactureerd **[D]**. Ailo toont "API-sleutel (los gefactureerd)" als een account toch zo is aangemeld.
- **Claude:** Pro, Max, Ultra, Team en Enterprise werken via `/login` **[D]**. Belangrijk: de Agent SDK-documentatie zegt: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products"* **[D]**. Ailo is ontworpen als **persoonlijk hulpmiddel** dat jouw eigen geïnstalleerde CLI met jouw eigen login aanstuurt, net als `claude -p` in een eigen script. Wie Ailo aan anderen wil aanbieden, heeft goedkeuring van Anthropic nodig of moet overstappen op API-sleutels **[A]**: dit is geen juridisch advies.
- Gebruikslimieten blijven per abonnement gelden. Ailo omzeilt of deelt ze niet.

## 4. Bewijs

| Controle | Resultaat |
|---|---|
| Codex: twee homes met elk een (nep-)login, tegelijk aanwezig | **[G]** onafhankelijk, twee aparte items in Referentiebeheer, geen `auth.json` |
| Claude: ingelogde map naast een lege map, tegelijk actief | **[G]** de ingelogde map antwoordt; de lege map geeft "Not logged in", zonder terugval |
| Claude-adapter: streamen, hervatten, toestemming weigeren, stoppen | **[G]** `test/integration.claude.test.ts` (echte CLI) |
| Ailo-UI: route account → project → gesprek → stream → hervatten na herstart | **[G]** |
| Twee gelijktijdige gesprekken, waarschuwing bij een gedeelde map, crashherstel | **[G]** |
| `scripts/isolation-proof.mjs` herkent ontbrekende isolatie | **[G]** negatieve test: twee accounts naar dezelfde map → 4 controles falen, zoals bedoeld |
| **Twee échte Codex-accounts** (zakelijk en persoonlijk) | **[G]** `npm run proof`: 11/11 geslaagd. Gelijktijdig gesprek, sessies alleen in de eigen map, elk onthoudt het eigen gesprek, B kan de sessie van A niet openen, identiteiten ongewijzigd, geen `auth.json` |
| Twee échte Claude-accounts | Openstaand: er is nog maar één Claude-account |

## 5. Incident tijdens het onderzoek

Bij de eerste Codex-test viel `CODEX_HOME` weg door een fout in een shellhulpfunctie. Twee nep-API-sleutels overschreven daardoor de globale login in `~/.codex/auth.json`. De nep-sleutel is verwijderd en de gebruiker heeft de globale login daarna hersteld. Dit was een incident in het onderzoek, geen openstaand herstelpunt. Ailo zelf gebruikt altijd een eigen `CODEX_HOME`; de tests controleren de accountisolatie.
