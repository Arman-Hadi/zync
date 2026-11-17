import { Notice, Plugin, Platform, TFile } from "obsidian";
import { DEFAULT_SETTINGS, type SyncState, type ZyncSettings } from "./types";
import { S3Client } from "./s3/client";
import { MetaStore } from "./local/meta-store";
import { SyncEngine } from "./sync/engine";
import { ZyncSettingTab } from "./settings";
import { applyTombstone } from "./sync/planner";
import { ProtectedFolderManager } from "./protect/manager";
import { UnlockModal } from "./protect/unlock-modal";

export default class ZyncPlugin extends Plugin {
  settings: ZyncSettings = { ...DEFAULT_SETTINGS };
  private meta!: MetaStore;
  private s3!: S3Client;
  private engine!: SyncEngine;
  protection!: ProtectedFolderManager;
  private intervalId: number | null = null;
  private statusEl: HTMLElement | null = null;
  private autoLockInFlight: Promise<void> | null = null;
  private autoLockTimer: number | null = null;
  private suppressAutoLockUntil = 0;

  async onload() {
    await this.loadSettings();

    this.meta = new MetaStore(this);
    await this.meta.load();

    this.protection = new ProtectedFolderManager(
      this.app,
      () => this.settings,
      async () => this.saveSettings(),
    );
    await this.protection.recoverPartials();
    await this.warnIfPlaintextWhileLocked();

    this.s3 = new S3Client(this.settings);
    this.engine = new SyncEngine(
      this.app,
      this.settings,
      this.s3,
      this.meta,
      async (state) => this.persistState(state),
      this.protection,
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

    this.addCommand({
      id: "lock-protected-folder",
      name: "Lock protected folder",
      callback: () => {
        void this.runLockFlow();
      },
    });

    this.addCommand({
      id: "unlock-protected-folder",
      name: "Unlock protected folder",
      callback: () => {
        if (this.protection.isUnlocked()) {
          new Notice("Zync: protected folder is already unlocked");
          return;
        }
        const needsConnect = !this.protection.isConfigured();
        new UnlockModal(
          this.app,
          async ({ password, folder }) => {
            try {
              if (needsConnect) {
                const result = await this.protection.connectAndUnlock(
                  folder ?? "",
                  password,
                );
                this.noteUnlockedRecently();
                new Notice(
                  `Zync: connected & unlocked (${result.decrypted} decrypted)`,
                );
              } else {
                const result = await this.protection.unlock(password);
                this.noteUnlockedRecently();
                new Notice(`Zync: unlocked (${result.decrypted} decrypted)`);
              }
            } catch (e) {
              new Notice(`Zync: ${e instanceof Error ? e.message : String(e)}`);
            }
          },
          {
            askFolder: needsConnect,
            initialFolder: this.settings.protectedFolder,
          },
        ).open();
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

    this.registerAutoLockOnAppHide();
    this.registerEnvelopeCacheUpdates();
    this.resetInterval();

    if (this.settings.syncOnLoad) {
      // Defer so the vault finishes loading
      const t = window.setTimeout(() => {
        void (async () => {
          // Don't spam sync errors if a previous quit left plaintext — repair modal handles it.
          if (
            this.protection.isLocked() &&
            (await this.protection.hasPlaintextProtectedFiles())
          ) {
            return;
          }
          await this.runSync(false);
        })();
      }, 2500);
      this.register(() => window.clearTimeout(t));
    }
  }

  onunload() {
    this.clearInterval();
    // Sync desktop flush of warm ciphertext — must run before the process dies.
    this.protection?.emergencyQuitFlush();
  }

  private registerEnvelopeCacheUpdates(): void {
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) this.protection.scheduleEnvelopeCache(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) this.protection.scheduleEnvelopeCache(file);
      }),
    );
  }

  /**
   * Background: encrypt to disk but keep the key (resume on return).
   * Quit: sync-flush warm envelopes + drop the key.
   */
  private registerAutoLockOnAppHide(): void {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (this.autoLockTimer != null) window.clearTimeout(this.autoLockTimer);
        // Ignore tiny focus flickers; still short enough to run before a real quit.
        this.autoLockTimer = window.setTimeout(() => {
          this.autoLockTimer = null;
          void this.secureDiskKeepSession();
        }, 400);
      } else {
        if (this.autoLockTimer != null) {
          window.clearTimeout(this.autoLockTimer);
          this.autoLockTimer = null;
        }
        void this.resumeProtectedSession();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.register(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (this.autoLockTimer != null) window.clearTimeout(this.autoLockTimer);
    });

    const onLeaving = () => {
      // Immediate sync write of cached ciphertext, then drop key.
      this.protection.emergencyQuitFlush();
    };
    window.addEventListener("pagehide", onLeaving);
    window.addEventListener("beforeunload", onLeaving);
    this.register(() => {
      window.removeEventListener("pagehide", onLeaving);
      window.removeEventListener("beforeunload", onLeaving);
    });
  }

  private async secureDiskKeepSession(): Promise<void> {
    if (!this.protection?.isConfigured() || !this.protection.isUnlocked()) return;
    if (Date.now() < this.suppressAutoLockUntil) return;
    if (this.autoLockInFlight) return this.autoLockInFlight;

    this.autoLockInFlight = (async () => {
      try {
        const result = await this.protection.secureDisk({ clearSession: false });
        if (result.errors.length) {
          console.error("Zync: background secure errors", result.errors);
        } else {
          console.info(`Zync: secured disk (${result.encrypted} encrypted, session kept)`);
        }
      } catch (e) {
        console.error("Zync: background secure failed", e);
      } finally {
        this.autoLockInFlight = null;
      }
    })();
    return this.autoLockInFlight;
  }

  private async resumeProtectedSession(): Promise<void> {
    if (!this.protection?.isUnlocked() || !this.protection.isDiskSecured()) return;
    try {
      await this.protection.resumeSession();
      console.info("Zync: resumed protected session after focus");
    } catch (e) {
      console.error("Zync: resume failed", e);
    }
  }

  noteUnlockedRecently(): void {
    // Avoid immediately re-locking after unlock while UI settles.
    this.suppressAutoLockUntil = Date.now() + 2500;
  }

  async runLockFlow(): Promise<void> {
    if (!this.protection.isConfigured()) {
      new Notice("Zync: no protected folder configured");
      return;
    }

    try {
      if (this.protection.isUnlocked()) {
        const result = await this.protection.lock();
        this.reportLockResult(result);
        return;
      }

      if (!(await this.protection.hasPlaintextProtectedFiles())) {
        new Notice("Zync: protected folder is already locked");
        return;
      }

      new UnlockModal(this.app, async ({ password }) => {
        try {
          const result = await this.protection.lockWithPassword(password);
          this.reportLockResult(result);
        } catch (e) {
          new Notice(`Zync: ${e instanceof Error ? e.message : String(e)}`);
        }
      }).open();
    } catch (e) {
      new Notice(`Zync: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private reportLockResult(result: {
    encrypted: number;
    errors: string[];
  }): void {
    if (result.errors.length) {
      new Notice(`Zync: lock finished with errors — ${result.errors[0]}`);
    } else {
      new Notice(`Zync: locked (${result.encrypted} encrypted)`);
    }
  }

  private async warnIfPlaintextWhileLocked(): Promise<void> {
    if (!this.protection.isConfigured() || this.protection.isUnlocked()) return;
    try {
      if (await this.protection.hasPlaintextProtectedFiles()) {
        // One-shot repair prompt — should be rare after emergency quit flush.
        new Notice(
          "Zync: protected notes were left plaintext after a previous quit. Enter password to encrypt them.",
          10000,
        );
        new UnlockModal(this.app, async ({ password }) => {
          try {
            const result = await this.protection.lockWithPassword(password);
            this.reportLockResult(result);
          } catch (e) {
            new Notice(`Zync: ${e instanceof Error ? e.message : String(e)}`);
          }
        }).open();
      }
    } catch (e) {
      console.warn("Zync: plaintext check failed", e);
    }
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
