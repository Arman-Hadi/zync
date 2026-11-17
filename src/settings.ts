import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ZyncPlugin from "./main";

export class ZyncSettingTab extends PluginSettingTab {
  plugin: ZyncPlugin;

  constructor(app: App, plugin: ZyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

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
            this.plugin.settings.endpoint = value.trim();
            await this.plugin.saveSettings();
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
            this.plugin.settings.region = value.trim() || "auto";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Bucket")
      .addText((text) =>
        text.setValue(this.plugin.settings.bucket).onChange(async (value) => {
          this.plugin.settings.bucket = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Access key ID")
      .addText((text) =>
        text.setValue(this.plugin.settings.accessKeyId).onChange(async (value) => {
          this.plugin.settings.accessKeyId = value.trim();
          await this.plugin.saveSettings();
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
          this.plugin.settings.forcePathStyle = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Key prefix")
      .setDesc("Optional folder prefix inside the bucket (for example my-vault).")
      .addText((text) =>
        text.setValue(this.plugin.settings.prefix).onChange(async (value) => {
          this.plugin.settings.prefix = value.trim().replace(/^\/+|\/+$/g, "");
          await this.plugin.saveSettings();
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
            const n = Number(value);
            this.plugin.settings.syncIntervalMinutes = Number.isFinite(n) && n >= 0 ? n : 0;
            await this.plugin.saveSettings();
            this.plugin.resetInterval();
          }),
      );

    new Setting(containerEl)
      .setName("Sync on load")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnLoad).onChange(async (value) => {
          this.plugin.settings.syncOnLoad = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Ignore patterns")
      .setDesc("One glob per line. .obsidian and .trash are always skipped.")
      .addTextArea((area) => {
        area
          .setPlaceholder("private/**\n*.tmp")
          .setValue(this.plugin.settings.ignorePatterns)
          .onChange(async (value) => {
            this.plugin.settings.ignorePatterns = value;
            await this.plugin.saveSettings();
          });
        area.inputEl.rows = 4;
        area.inputEl.style.width = "100%";
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
  }
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
