import Store from 'electron-store';
import { app } from 'electron';
import { constants, copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeWar3RootPath } from './war3-path';
import { GraphicsSelection, VersionSelection } from '../../shared/mod-profile';
import { GameChannel } from '../../shared/game-channel';
import { ClientLanguage, isClientLanguage, systemLanguage } from '../../shared/system-language';

interface AppConfig {
    war3Path: string;
    gameChannel: GameChannel;
    channelModEnabled: Partial<Record<GameChannel, boolean>>;
    lastFullPackageBytes: number;
    language: ClientLanguage;
    theme: string;
    themeApplyToGame: boolean;
    // Mods
    antiHarmony: boolean;
    terrainMode: 'classic' | 'hd' | 'custom';
    lightMode: number; // 0-10
    modSettings: any & {
        versionSelection?: VersionSelection;
        graphicsSelection?: GraphicsSelection;
    };
    retroSkinUnits: boolean;
    retroSkinBuildings: boolean;
    customThemes?: any[];
    customSkins?: any[];
    skinSelections?: Record<string, import('../../shared/skin-versions').SkinSelections>;
}

const schema = {
    war3Path: {
        type: 'string',
        default: ''
    },
    gameChannel: {
        type: 'string',
        enum: ['retail', 'ptr'],
        default: 'retail'
    },
    channelModEnabled: {
        type: 'object',
        default: {},
        properties: {
            retail: { type: 'boolean' },
            ptr: { type: 'boolean' }
        },
        additionalProperties: false
    },
    lastFullPackageBytes: {
        type: 'number',
        default: 0
    },
    language: {
        type: 'string',
        enum: ['zh-CN', 'en-US', 'ko-KR', 'fr-FR', 'pt-BR', 'ru-RU', 'es-ES', 'pl-PL'],
        default: 'zh-CN'
    },
    theme: {
        type: 'string',
        default: 'magicstorm'
    },
    themeApplyToGame: {
        type: 'boolean',
        default: true
    },
    antiHarmony: {
        type: 'boolean',
        default: false
    },
    terrainMode: {
        type: 'string',
        enum: ['classic', 'hd', 'custom'],
        default: 'classic'
    },
    lightMode: {
        type: 'number',
        default: 4
    },
    modSettings: {
        type: 'object',
        default: { ui: 'classic' },
        additionalProperties: true
    },
    retroSkinUnits: {
        type: 'boolean',
        default: false
    },
    retroSkinBuildings: {
        type: 'boolean',
        default: false
    },
    customThemes: {
        type: 'array',
        default: [],
        items: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                videoPath: { type: 'string' },
                name: { type: 'string' }
            }
        }
    },
    skinSelections: { type: 'object', default: {}, additionalProperties: true },
    customSkins: {
        type: 'array',
        default: [],
        items: { type: 'object', additionalProperties: true }
    }
} as const;

export class ConfigManager {
    private store: Store<AppConfig>;
    private backupPath: string;
    private useSystemLanguage: boolean;

    constructor() {
        const isolatedConfigDir = process.env.QUENCHING_TEST_CONFIG_DIR;
        if (isolatedConfigDir && (!path.isAbsolute(isolatedConfigDir) || !existsSync(isolatedConfigDir))) {
            throw new Error('QUENCHING_TEST_CONFIG_DIR must be an existing absolute directory');
        }
        const configDir = isolatedConfigDir || app.getPath('userData');
        const configPath = path.join(configDir, 'config.json');
        this.backupPath = `${configPath}.bak`;

        // electron-store's clearInvalidConfig treats malformed JSON as an
        // empty store. The next settings write would then replace every saved
        // preference. Recover a known-good copy instead, preserving the bad
        // bytes for diagnosis; never silently start with an empty config.
        if (existsSync(configPath)) {
            try {
                JSON.parse(readFileSync(configPath, 'utf8'));
            } catch (error) {
                if (!existsSync(this.backupPath)) {
                    throw new Error(`Configuration is malformed; it was not cleared: ${configPath}`, { cause: error });
                }
                JSON.parse(readFileSync(this.backupPath, 'utf8'));
                copyFileSync(configPath, `${configPath}.corrupt-${Date.now()}-${process.pid}`, constants.COPYFILE_EXCL);
                copyFileSync(this.backupPath, configPath);
                console.warn(`[Config] Restored malformed configuration from backup: ${configPath}`);
            }
        }
        // Capture this before electron-store materializes the Chinese schema default.
        this.useSystemLanguage = !existsSync(configPath) || !isClientLanguage(JSON.parse(readFileSync(configPath, 'utf8')).language);
        const storeOptions = {
            schema: schema as any,
            clearInvalidConfig: false,
            cwd: configDir,
        };
        this.store = new Store<AppConfig>(storeOptions);
        this.backupCurrentConfig();
        console.log(`[Config] Using persistent store: ${this.store.path}`);
    }

    /** Call after app.ready, before opening any UI. Saved manual choices take precedence. */
    initializeSystemLanguage(): void {
        if (!this.useSystemLanguage) return;
        let language: ClientLanguage = 'zh-CN';
        try {
            const preferred = app.getPreferredSystemLanguages();
            language = systemLanguage(preferred.length ? preferred : [app.getSystemLocale()]);
        } catch { /* Locale detection can fail; the specified fallback is Chinese. */ }
        this.set('language', language);
    }

    private backupCurrentConfig(): void {
        if (!existsSync(this.store.path)) return;
        try {
            copyFileSync(this.store.path, this.backupPath);
        } catch (error) {
            console.warn('[Config] Could not refresh configuration backup:', error);
        }
    }

    get<K extends keyof AppConfig>(key: K): AppConfig[K] {
        let value = this.store.get(key);

        // Repair configurations written by older versions when the user chose
        // `_retail_` itself in the directory picker.
        if (key === 'war3Path' && typeof value === 'string' && value) {
            const normalized = normalizeWar3RootPath(value);
            if (normalized !== value) {
                console.warn(`[Config] Normalized Warcraft III path: ${value} -> ${normalized}`);
                this.store.set('war3Path', normalized);
                this.backupCurrentConfig();
                value = normalized as AppConfig[K];
            }
        }
        return value;
    }

    set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
        if (key === 'war3Path' && typeof value === 'string') {
            value = normalizeWar3RootPath(value) as AppConfig[K];
        }
        this.store.set(key, value);
        if (key === 'language') this.useSystemLanguage = false;
        this.backupCurrentConfig();
    }

    onDidChange(key: keyof AppConfig, callback: () => void): () => void {
        return this.store.onDidChange(key, callback);
    }

    delete<K extends keyof AppConfig>(key: K): void {
        this.store.delete(key);
        this.backupCurrentConfig();
    }

    getAll(): AppConfig {
        return this.store.store;
    }

    hasWar3Path(): boolean {
        return !!this.store.get('war3Path');
    }
}

export const configManager = new ConfigManager();
