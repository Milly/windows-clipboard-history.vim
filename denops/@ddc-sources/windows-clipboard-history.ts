import type { Denops } from "jsr:@denops/core@^7.0.0";
import {
  BaseSource,
  type GatherArguments,
  type OnCompleteDoneArguments,
  type OnInitArguments,
} from "jsr:@shougo/ddc-vim@^6.0.0/source";
import type { Item as DdcItem } from "jsr:@shougo/ddc-vim@^6.0.0/types";
import { globalOptions } from "jsr:@denops/std@^7.0.0/variable";
import {
  Unprintable,
  type UnprintableUserData,
} from "jsr:@milly/ddc-unprintable@^4.0.0";
import {
  ClipboardHistory,
  ClipboardHistoryItem,
} from "../windows-clipboard-history/clipboard-history.ts";
import { toDuration } from "../windows-clipboard-history/time.ts";

type Params = {
  /** PowerShell executable path. (default: "powershell.exe") */
  pwsh: string;
  /** Cache expires interval. (default: 3000 [msec]) */
  cacheExpires: number;
  /** Max width of the abbreviates column. (default: 0)
   *
   * If 0 is specified, be unlimited.
   */
  maxAbbrWidth: number;
  /** Highlight group name for unprintable chars. (default: "SpecialKey")
   *
   * If empty, highlight is disabled.
   */
  ctrlCharHlGroup: string;
};

type OperatorWise = "c" | "l" | "b" | "";

type UserData = Record<string, never> & UnprintableUserData;

type Item = DdcItem<UserData>;

export class Source extends BaseSource<Params, UserData> {
  #unprintable?: Unprintable<UserData>;
  #clipboardHistory?: ClipboardHistory;

  override params(): Params {
    return {
      pwsh: "powershell.exe",
      cacheExpires: 3000,
      maxAbbrWidth: 0,
      ctrlCharHlGroup: "SpecialKey",
    };
  }

  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    const { sourceParams: { ctrlCharHlGroup, pwsh, cacheExpires } } = args;

    this.#clipboardHistory = new ClipboardHistory({ pwsh, cacheExpires });
    this.#unprintable = new Unprintable<UserData>({
      highlightGroup: ctrlCharHlGroup,
      callbackId: `source/${this.name}`,
    });
    await this.#unprintable.onInit(args);
  }

  override async gather(
    args: GatherArguments<Params>,
  ): Promise<Item[]> {
    const {
      denops,
      context: { nextInput },
      sourceParams: { maxAbbrWidth, ctrlCharHlGroup },
      sourceOptions: { maxItems },
    } = args;

    const [abbrWidth, recentHistory] = await Promise.all([
      this.#getAbbrWidth(denops, maxAbbrWidth),
      this.#getHistory(maxItems),
    ]);
    this.#unprintable!.abbrWidth = abbrWidth;
    this.#unprintable!.highlightGroup = ctrlCharHlGroup;
    const items = this.#generateItems(recentHistory);
    return this.#unprintable!.convertItems(denops, items, nextInput);
  }

  override onCompleteDone(
    args: OnCompleteDoneArguments<Params, UserData>,
  ): Promise<void> {
    return this.#unprintable!.onCompleteDone(args);
  }

  async #getAbbrWidth(denops: Denops, maxAbbrWidth: number): Promise<number> {
    const vimColumns = await globalOptions.get(denops, "columns", 9999);
    return maxAbbrWidth > 0 ? Math.min(maxAbbrWidth, vimColumns) : vimColumns;
  }

  async #getHistory(maxItems: number): Promise<ClipboardHistoryItem[]> {
    if (!this.#clipboardHistory) {
      throw new Error("Object not initialized");
    }
    const history = await this.#clipboardHistory.getHistory();
    return history.slice(0, Math.max(1, maxItems));
  }

  #generateItems(history: ClipboardHistoryItem[]): Item[] {
    const now = Date.now();
    return history.map(({ Text, Time }): Item => {
      const word = Text.replaceAll("\r\n", "\n");
      const wise: OperatorWise = word.endsWith("\n") ? "l" : "c";
      const duration = toDuration(now - Time);
      return {
        word,
        info: word,
        kind: wise,
        menu: duration,
      };
    });
  }
}
