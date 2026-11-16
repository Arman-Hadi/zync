import type { Plugin } from "obsidian";
import { EMPTY_SYNC_STATE, type SyncState } from "../types";

const STATE_KEY = "zyncSyncState";

export class MetaStore {
  private state: SyncState = { ...EMPTY_SYNC_STATE, files: {}, tombstones: {} };

  constructor(private plugin: Plugin) {}

  async load(): Promise<SyncState> {
    const data = (await this.plugin.loadData()) as
      | (Record<string, unknown> & { [STATE_KEY]?: SyncState })
      | null;
    const raw = data?.[STATE_KEY];
    if (raw && raw.version === 1 && raw.files && raw.tombstones) {
      this.state = {
        version: 1,
        files: { ...raw.files },
        tombstones: { ...raw.tombstones },
        lastSyncAt: raw.lastSyncAt ?? null,
      };
    } else {
      this.state = {
        version: 1,
        files: {},
        tombstones: {},
        lastSyncAt: null,
      };
    }
    return this.get();
  }

  get(): SyncState {
    return {
      version: 1,
      files: { ...this.state.files },
      tombstones: { ...this.state.tombstones },
      lastSyncAt: this.state.lastSyncAt,
    };
  }

  async save(state: SyncState, settingsPayload: Record<string, unknown>): Promise<void> {
    this.state = {
      version: 1,
      files: { ...state.files },
      tombstones: { ...state.tombstones },
      lastSyncAt: state.lastSyncAt,
    };
    await this.plugin.saveData({
      ...settingsPayload,
      [STATE_KEY]: this.state,
    });
  }
}
