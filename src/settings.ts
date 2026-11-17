import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";
import type ZyncPlugin from "./main";
import type { ZyncSettings } from "./types";

export class ZyncSettingTab extends PluginSettingTab {
  plugin: ZyncPlugin;
  /** Draft fields — never persisted. */
  private draftFolder = "";
  private draftPassword = "";
  private draftUnlockPassword = "";

  constructor(app: App, plugin: ZyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    if (key === "syncIntervalMinutes") {
      const n = Number(value);
      settings[key] = Number.isFinite(n) && n >= 0 ? n : 0;
    } else if (
      typeof value === "string" &&
      (key === "endpoint" ||
        key === "region" ||
        key === "bucket" ||
        key === "accessKeyId" ||
        key === "prefix")
    ) {
      let next = value.trim();
      if (key === "region" && !next) next = "auto";
      if (key === "prefix") next = next.replace(/^\/+|\/+$/g, "");
      settings[key] = next;
    } else {
      settings[key] = value;
    }

    await this.plugin.saveSettings();
    if (key === "syncIntervalMinutes") {
      this.plugin.resetInterval();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof ZyncSettings>[] {
    const configDir = this.app.vault.configDir;
    return [
      {
        name: "About",
        desc: "Two-way vault sync over S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2, and similar). Works on desktop and mobile.",
      },
      {
        type: "group",
        heading: "Connection",
        items: [
          {
            name: "Endpoint",
            desc: "Leave empty for AWS S3. For R2, MinIO, or B2 use the full HTTPS endpoint.",
            control: {
              type: "text",
              key: "endpoint",
              placeholder: "https://<account>.r2.cloudflarestorage.com",
            },
          },
          {
            name: "Region",
            desc: "AWS region, or auto / us-east-1 for many S3-compatible providers.",
            control: { type: "text", key: "region", placeholder: "auto" },
          },
          {
            name: "Bucket",
            control: { type: "text", key: "bucket" },
          },
          {
            name: "Access key ID",
            control: { type: "text", key: "accessKeyId" },
          },
          {
            name: "Secret access key",
            render: (setting) => {
              setting.addText((text) => {
                text.inputEl.type = "password";
                text.setValue(this.plugin.settings.secretAccessKey).onChange(async (value) => {
                  this.plugin.settings.secretAccessKey = value;
                  await this.plugin.saveSettings();
                });
              });
            },
          },
          {
            name: "Force path-style URLs",
            desc: "Recommended for MinIO and many S3-compatible endpoints.",
            control: { type: "toggle", key: "forcePathStyle" },
          },
          {
            name: "Key prefix",
            desc: "Optional folder prefix inside the bucket (for example my-vault).",
            control: { type: "text", key: "prefix" },
          },
        ],
      },
      {
        type: "group",
        heading: "Sync",
        items: [
          {
            name: "Sync interval (minutes)",
            desc: "0 = manual only.",
            control: {
              type: "number",
              key: "syncIntervalMinutes",
              min: 0,
              placeholder: "5",
            },
          },
          {
            name: "Sync on load",
            control: { type: "toggle", key: "syncOnLoad" },
          },
          {
            name: "Ignore patterns",
            desc: `One glob per line. ${configDir} and .trash are always skipped.`,
            control: {
              type: "textarea",
              key: "ignorePatterns",
              placeholder: "private/**\n*.tmp",
              rows: 4,
            },
          },
          {
            name: "Test connection",
            desc: "List objects in the bucket to verify credentials.",
            render: (setting) => {
              setting.addButton((btn) =>
                btn.setButtonText("Test").onClick(async () => {
                  btn.setDisabled(true);
                  try {
                    await this.plugin.testConnection();
                    new Notice("Zync: connection OK");
                  } catch (e) {
                    new Notice(`Zync: connection failed — ${errMessage(e)}`);
                  } finally {
                    btn.setDisabled(false);
                  }
                }),
              );
            },
          },
          {
            name: "Sync now",
            render: (setting) => {
              setting.addButton((btn) =>
                btn
                  .setButtonText("Sync")
                  .setCta()
                  .onClick(async () => {
                    await this.plugin.runSync(true);
                  }),
              );
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Protected folder",
        items: [
          {
            name: "Status",
            desc: this.protectionStatusText(),
          },
          {
            name: "Folder",
            desc: "One vault folder whose Markdown notes are encrypted when locked. Synced to S3 only in encrypted form.",
            render: (setting) => this.renderProtectedFolderControls(setting),
          },
        ],
      },
    ];
  }

  /** Fallback for Obsidian versions before declarative settings (1.13). */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("zync-settings");

    containerEl.createEl("p", {
      text: "Two-way vault sync over S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2, and similar). Works on desktop and mobile.",
    });

    new Setting(containerEl).setName("Connection").setHeading();

    new Setting(containerEl)
      .setName("Endpoint")
      .setDesc("Leave empty for AWS S3. For R2, MinIO, or B2 use the full HTTPS endpoint.")
      .addText((text) =>
        text
          .setPlaceholder("https://<account>.r2.cloudflarestorage.com")
          .setValue(this.plugin.settings.endpoint)
          .onChange(async (value) => {
            await this.setControlValue("endpoint", value);
          }),
      );

    new Setting(containerEl)
      .setName("Region")
      .setDesc("AWS region, or auto / us-east-1 for many S3-compatible providers.")
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.region)
          .onChange(async (value) => {
            await this.setControlValue("region", value);
          }),
      );

    new Setting(containerEl)
      .setName("Bucket")
      .addText((text) =>
        text.setValue(this.plugin.settings.bucket).onChange(async (value) => {
          await this.setControlValue("bucket", value);
        }),
      );

    new Setting(containerEl)
      .setName("Access key ID")
      .addText((text) =>
        text.setValue(this.plugin.settings.accessKeyId).onChange(async (value) => {
          await this.setControlValue("accessKeyId", value);
        }),
      );

    new Setting(containerEl)
      .setName("Secret access key")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.secretAccessKey).onChange(async (value) => {
          this.plugin.settings.secretAccessKey = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Force path-style URLs")
      .setDesc("Recommended for MinIO and many S3-compatible endpoints.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.forcePathStyle).onChange(async (value) => {
          await this.setControlValue("forcePathStyle", value);
        }),
      );

    new Setting(containerEl)
      .setName("Key prefix")
      .setDesc("Optional folder prefix inside the bucket (for example my-vault).")
      .addText((text) =>
        text.setValue(this.plugin.settings.prefix).onChange(async (value) => {
          await this.setControlValue("prefix", value);
        }),
      );

    new Setting(containerEl).setName("Sync").setHeading();

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc("0 = manual only.")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            await this.setControlValue("syncIntervalMinutes", Number(value));
          }),
      );

    new Setting(containerEl)
      .setName("Sync on load")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnLoad).onChange(async (value) => {
          await this.setControlValue("syncOnLoad", value);
        }),
      );

    new Setting(containerEl)
      .setName("Ignore patterns")
      .setDesc(
        `One glob per line. ${this.app.vault.configDir} and .trash are always skipped.`,
      )
      .addTextArea((area) => {
        area.inputEl.addClass("zync-ignore-patterns");
        area
          .setPlaceholder("private/**\n*.tmp")
          .setValue(this.plugin.settings.ignorePatterns)
          .onChange(async (value) => {
            await this.setControlValue("ignorePatterns", value);
          });
        area.inputEl.rows = 4;
      });

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("List objects in the bucket to verify credentials.")
      .addButton((btn) =>
        btn.setButtonText("Test").onClick(async () => {
          btn.setDisabled(true);
          try {
            await this.plugin.testConnection();
            new Notice("Zync: connection OK");
          } catch (e) {
            new Notice(`Zync: connection failed — ${errMessage(e)}`);
          } finally {
            btn.setDisabled(false);
          }
        }),
      );

    new Setting(containerEl)
      .setName("Sync now")
      .addButton((btn) =>
        btn
          .setButtonText("Sync")
          .setCta()
          .onClick(async () => {
            await this.plugin.runSync(true);
          }),
      );

    this.renderProtectedFolderSection(containerEl);
  }

  private protectionStatusText(): string {
    const p = this.plugin.protection;
    if (!p.isConfigured()) {
      return "No protected folder on this device. Enable a new one, or Connect if notes were encrypted on another device.";
    }
    const folder = p.getFolder();
    if (p.isUnlocked()) {
      return `"${folder}" is unlocked. Notes are plaintext on disk; sync still uploads ciphertext only.`;
    }
    return `"${folder}" is locked. Markdown notes inside are encrypted on disk and in S3.`;
  }

  private renderProtectedFolderSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Protected folder").setHeading();

    new Setting(containerEl).setName("Status").setDesc(this.protectionStatusText());

    const folderSetting = new Setting(containerEl)
      .setName("Folder")
      .setDesc(
        "One vault folder whose Markdown notes are encrypted when locked. Synced to S3 only in encrypted form.",
      );
    this.renderProtectedFolderControls(folderSetting);
  }

  private renderProtectedFolderControls(setting: Setting): void {
    const configured = this.plugin.protection.isConfigured();
    const unlocked = this.plugin.protection.isUnlocked();

    if (!configured) {
      if (!this.draftFolder) {
        this.draftFolder = this.plugin.settings.protectedFolder || "";
      }
      setting.addText((text) => {
        text
          .setPlaceholder("Private")
          .setValue(this.draftFolder)
          .onChange((value) => {
            this.draftFolder = value;
          });
      });
      setting.addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("Password").setValue(this.draftPassword).onChange((value) => {
          this.draftPassword = value;
        });
      });
      setting.addButton((btn) =>
        btn.setButtonText("Enable & encrypt").setCta().onClick(async () => {
          btn.setDisabled(true);
          try {
            const result = await this.plugin.protection.enable(
              this.draftFolder,
              this.draftPassword,
            );
            this.draftPassword = "";
            if (result.errors.length) {
              new Notice(`Zync: enabled with errors — ${result.errors[0]}`);
            } else if (result.encrypted === 0 && result.skipped > 0) {
              new Notice(
                `Zync: linked existing protected folder (${result.skipped} notes, locked)`,
              );
            } else {
              new Notice(
                `Zync: protected folder enabled (${result.encrypted} encrypted, locked)`,
              );
            }
            this.display();
          } catch (e) {
            new Notice(`Zync: ${errMessage(e)}`);
          } finally {
            btn.setDisabled(false);
          }
        }),
      );
      setting.addButton((btn) =>
        btn.setButtonText("Connect & unlock").onClick(async () => {
          btn.setDisabled(true);
          try {
            const result = await this.plugin.protection.connectAndUnlock(
              this.draftFolder,
              this.draftPassword,
            );
            this.draftPassword = "";
            new Notice(
              `Zync: connected & unlocked (${result.decrypted} decrypted)`,
            );
            this.display();
          } catch (e) {
            new Notice(`Zync: ${errMessage(e)}`);
          } finally {
            btn.setDisabled(false);
          }
        }),
      );
      return;
    }

    if (unlocked) {
      setting.addButton((btn) =>
        btn.setButtonText("Lock").setCta().onClick(async () => {
          btn.setDisabled(true);
          try {
            const result = await this.plugin.protection.lock();
            if (result.errors.length) {
              new Notice(`Zync: lock errors — ${result.errors[0]}`);
            } else {
              new Notice(`Zync: locked (${result.encrypted} encrypted)`);
            }
            this.display();
          } catch (e) {
            new Notice(`Zync: ${errMessage(e)}`);
          } finally {
            btn.setDisabled(false);
          }
        }),
      );
      setting.addButton((btn) =>
        btn.setButtonText("Disable").setWarning().onClick(async () => {
          btn.setDisabled(true);
          try {
            await this.plugin.protection.disable();
            this.draftFolder = "";
            this.draftPassword = "";
            new Notice("Zync: protection disabled; notes decrypted");
            this.display();
          } catch (e) {
            new Notice(`Zync: ${errMessage(e)}`);
          } finally {
            btn.setDisabled(false);
          }
        }),
      );
      return;
    }

    // Locked
    setting.addText((text) => {
      text.inputEl.type = "password";
      text
        .setPlaceholder("Password")
        .setValue(this.draftUnlockPassword)
        .onChange((value) => {
          this.draftUnlockPassword = value;
        });
    });
    setting.addButton((btn) =>
      btn.setButtonText("Unlock").setCta().onClick(async () => {
        btn.setDisabled(true);
        try {
          await this.plugin.protection.unlock(this.draftUnlockPassword);
          this.draftUnlockPassword = "";
          new Notice("Zync: protected folder unlocked");
          this.display();
        } catch (e) {
          new Notice(`Zync: ${errMessage(e)}`);
        } finally {
          btn.setDisabled(false);
        }
      }),
    );
    setting.addButton((btn) =>
      btn.setButtonText("Lock").onClick(async () => {
        new Notice("Zync: folder is already locked");
      }),
    );
  }
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
