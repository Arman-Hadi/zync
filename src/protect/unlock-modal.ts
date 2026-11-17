import { App, Modal, Setting } from "obsidian";

export interface UnlockModalResult {
  password: string;
  folder?: string;
}

export class UnlockModal extends Modal {
  private password = "";
  private folder = "";
  private readonly askFolder: boolean;
  private readonly initialFolder: string;
  private readonly onSubmit: (result: UnlockModalResult) => void | Promise<void>;

  constructor(
    app: App,
    onSubmit: (result: UnlockModalResult) => void | Promise<void>,
    options?: { askFolder?: boolean; initialFolder?: string },
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.askFolder = !!options?.askFolder;
    this.initialFolder = options?.initialFolder ?? "";
    this.folder = this.initialFolder;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", {
      text: this.askFolder ? "Connect protected folder" : "Unlock protected folder",
    });
    if (this.askFolder) {
      contentEl.createEl("p", {
        text: "Enter the same folder name and password you use on your other device. Zync reads the encryption salt from synced notes — no file copying needed.",
      });
    }

    if (this.askFolder) {
      new Setting(contentEl).setName("Folder").addText((text) => {
        text
          .setPlaceholder("Private")
          .setValue(this.folder)
          .onChange((value) => {
            this.folder = value;
          });
      });
    }

    new Setting(contentEl)
      .setName("Password")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.focus();
        text.onChange((value) => {
          this.password = value;
        });
        text.inputEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            void this.submit();
          }
        });
      });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.askFolder ? "Connect & unlock" : "Unlock")
          .setCta()
          .onClick(() => {
            void this.submit();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    this.password = "";
  }

  private async submit(): Promise<void> {
    const result: UnlockModalResult = {
      password: this.password,
      folder: this.askFolder ? this.folder : undefined,
    };
    this.close();
    await this.onSubmit(result);
  }
}
