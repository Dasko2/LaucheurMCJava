# LaucheurJava — Launcher Minecraft Java

Launcher Minecraft Java mode Offline avec support Fabric, gestion de mods et interface inspirée de Lunar Client.

---

## Arborescence complète

```
LaucheurJava/
├── package.json          ← Dépendances Electron + scripts npm
├── main.js               ← Processus principal Electron (IPC, téléchargement, lancement)
├── preload.js            ← Pont sécurisé main ↔ renderer (contextBridge)
├── index.html            ← Interface HTML du launcher
├── style.css             ← Styles (thème sombre inspiré Lunar Client)
├── renderer.js           ← Logique UI (events, logs, préférences, mods)
├── README.md             ← Ce fichier
├── .gitignore
│
├── assets/
│   └── icons/
│       ├── icon.png      ← Icône app (Linux / barre de titre)
│       ├── icon.ico      ← Icône app (Windows)
│       └── icon.icns     ← Icône app (macOS)
│
└── mods/                 ← Placez ici vos fichiers .jar Fabric
    ├── Sodium-mc1.20.1-0.5.8.jar           (HUD FPS)
    ├── LambDynamicLights-3.1.0+mc1.20.1.jar (FullBright)
    ├── FabricSkyboxes-2.4.4+mc1.20.1.jar   (NoFog)
    ├── ClearDespawn-1.1.13+mc1.20.1.jar    (ClearLava)
    ├── ClickrMod-1.3.0+1.20.1.jar          (HUD CPS)
    └── AppleSkin-mc1.20.1-2.5.1.jar        (Player Health)
```

---

## Installation & Lancement

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le launcher (développement)
npm start

# 3. Lancer avec DevTools ouverts
npm run dev

# 4. Builder l'application (installeur)
npm run build
```

---

## Ajouter des mods

1. Téléchargez les fichiers `.jar` Fabric correspondant à votre version Minecraft.
2. Copiez-les dans le dossier `mods/` du launcher (ou cliquez **Dossier mods** dans l'interface).
3. Les mods doivent commencer par le nom exact listé ci-dessous :

| Option        | Fichier JAR (début du nom)  | Lien de téléchargement                         |
|---------------|-----------------------------|------------------------------------------------|
| FullBright    | `LambDynamicLights`         | https://modrinth.com/mod/lambdynamiclights      |
| NoFog         | `FabricSkyboxes`            | https://modrinth.com/mod/fabricskyboxes         |
| ClearLava     | `ClearDespawn`              | https://modrinth.com/mod/cleardespawn           |
| HUD FPS       | `Sodium`                    | https://modrinth.com/mod/sodium                 |
| HUD CPS       | `ClickrMod`                 | https://modrinth.com/mod/clickr                 |
| Player Health | `AppleSkin`                 | https://modrinth.com/mod/appleskin              |

> ⚠️ Sodium nécessite aussi **Fabric API** : https://modrinth.com/mod/fabric-api

---

## Versions Minecraft supportées

| Version | Nom               | Fabric Loader |
|---------|-------------------|---------------|
| 1.20.1  | Trails & Tales    | 0.15.11       |
| 1.19.4  | Wild Update       | 0.15.11       |
| 1.18.2  | Caves & Cliffs    | 0.14.25       |

---

## Structure du code

### `main.js` — Processus principal
- Crée la fenêtre Electron (sans barre de titre native)
- Télécharge et installe Fabric via l'API `meta.fabricmc.net`
- Lance Minecraft via `minecraft-launcher-core`
- Gère les mods : vide `minecraft/mods/`, copie uniquement les JARs actifs
- Expose des handlers IPC : `launch:game`, `mods:list`, `mods:open-folder`, `app:info`

### `preload.js` — Pont sécurisé
- Expose `window.launcher` via `contextBridge` (jamais Node.js directement)
- Fonctions : `launch`, `listMods`, `openModsFolder`, `getInfo`, `minimize`, `maximize`, `close`
- Listeners : `onLog`, `onProgress`

### `renderer.js` — Interface utilisateur
- Charge et sauvegarde les préférences en `localStorage`
- Gère les toggles de mods et met à jour `enabledMods`
- Rafraîchit automatiquement l'état des JARs toutes les 10s
- Valide le pseudo avant lancement
- Affiche les logs et la progression en temps réel

---

## Ajouter Microsoft Login (futur)

Dans `main.js`, la section authentification est prête pour l'extension :

```js
// Authentification hors-ligne (actuel)
const auth = Authenticator.getAuth(username.trim());

// Microsoft Login (futur — remplacer par msmc ou electron-msal)
// const auth = await MicrosoftAuth.getAuth(); // ← plug-in futur
```

---

## Dossier du jeu

Le jeu s'installe dans le dossier userData d'Electron :
- **Windows** : `%APPDATA%\LaucheurJava\minecraft`
- **macOS**   : `~/Library/Application Support/LaucheurJava/minecraft`
- **Linux**   : `~/.config/LaucheurJava/minecraft`
