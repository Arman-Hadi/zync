import { Notice, Plugin, Platform } from "obsidian";
import { DEFAULT_SETTINGS, type SyncState, type ZyncSettings } from "./types";
import { S3Client } from "./s3/client";
import { MetaStore } from "./local/meta-store";
import { SyncEngine } from "./sync/engine";
import { ZyncSettingTab } from "./settings";
import { applyTombstone } from "./sync/planner";

export default class ZyncPlugin extends Plugin {
  settings: ZyncSettings = { ...DEFAULT_SETTINGS };
  private meta!: MetaStore;
  private s3!: S3Client;
  private engine!: SyncEngine;
  private intervalId: number | null = null;
  private statusEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    this.meta = new MetaStore(this);
    await this.meta.load();

    this.s3 = new S3Client(this.settings);
    this.engine = new SyncEngine(
      this.app,
      this.settings,
      this.s3,
      this.meta,
      async (state) => this.persistState(state),
    );

    this.addRibbonIcon("refresh-cw", "Zync: sync now", async () => {
      await this.runSync(true);
    });

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        await this.runSync(true);
      },
    });

    this.addCommand({
      id: "test-connection",
      name: "Test S3 connection",
      callback: async () => {
        try {
          await this.testConnection();
          new Notice("Zync: connection OK");
        } catch (e) {
          new Notice(
            `Zync: connection failed — ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      },
    });

    this.addSettingTab(new ZyncSettingTab(this.app, this));

    if (Platform.isDesktopApp) {
      this.statusEl = this.addStatusBarItem();
      this.statusEl.setText("Zync");
    }

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        const state = this.meta.get();
        if (state.files[file.path] || state.tombstones[file.path]) {
          const next = applyTombstone(state, file.path, Date.now());
          void this.persistState(next);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const state = this.meta.get();
        if (state.files[oldPath]) {
          let next = applyTombstone(state, oldPath, Date.now());
          const files = { ...next.files };
          delete files[oldPath];
          next = { ...next, files };
          void this.persistState(next);
        }
        // New path will upload on next sync
        void file;
      }),
    );

    this.resetInterval();

    if (this.settings.syncOnLoad) {
      // Defer so the vault finishes loading
      const t = window.setTimeout(() => {
        void this.runSync(false);
      }, 2500);
      this.register(() => window.clearTimeout(t));
    }
  }

  onunload() {
    this.clearInterval();
  }

  async loadSettings() {
    const data = (await this.loadData()) as (Partial<ZyncSettings> & Record<string, unknown>) | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    // Strip sync state fields from settings object view
    delete (this.settings as unknown as Record<string, unknown>)["zyncSyncState"];
  }

  async saveSettings() {
    await this.persistState(this.meta.get());
    this.engine.updateSettings(this.settings);
    this.s3.updateSettings(this.settings);
  }

  private async persistState(state: SyncState) {
    const payload = { ...this.settings } as unknown as Record<string, unknown>;
    await this.meta.save(state, payload);
  }

  async testConnection() {
    this.s3.updateSettings(this.settings);
    await this.s3.testConnection();
  }

  async runSync(interactive: boolean) {
    if (this.engine.isRunning()) {
      if (interactive) new Notice("Zync: sync already running");
      return;
    }
    if (interactive) new Notice("Zync: syncing…");
    this.setStatus("Zync…");
    const result = await this.engine.sync();
    const summary =
      `↑${result.uploaded} ↓${result.downloaded} ` +
      `✕r${result.deletedRemote} ✕l${result.deletedLocal} ` +
      `↯${result.conflicts}` +
      (result.errors.length ? ` !${result.errors.length}` : "");

    this.setStatus(`Zync ${summary}`);

    if (interactive || result.errors.length) {
      if (result.errors.length) {
        new Notice(`Zync finished with errors: ${result.errors[0]}`);
        console.error("Zync errors", result.errors);
      } else if (interactive) {
        new Notice(`Zync done (${result.durationMs}ms): ${summary}`);
      }
    }
  }

  resetInterval() {
    this.clearInterval();
    const minutes = this.settings.syncIntervalMinutes;
    if (minutes > 0) {
      this.intervalId = window.setInterval(
        () => {
          void this.runSync(false);
        },
        minutes * 60 * 1000,
      );
    }
  }

  private clearInterval() {
    if (this.intervalId != null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private setStatus(text: string) {
    if (this.statusEl) this.statusEl.setText(text);
  }
}
