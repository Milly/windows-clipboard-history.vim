import type { SetRequired } from "https://cdn.skypack.dev/type-fest@3.2.0?dts";
import type {
  GatherArguments,
  OnCompleteDoneArguments,
  OnInitArguments,
} from "https://deno.land/x/ddc_vim@v3.1.0/base/source.ts";
import { BaseSource } from "https://deno.land/x/ddc_vim@v3.1.0/types.ts";
import type {
  Item as DdcItem,
  PumHighlight,
} from "https://deno.land/x/ddc_vim@v3.1.0/types.ts";
import { strlen } from "https://deno.land/x/denops_std@v3.9.1/function/mod.ts";
import type { Denops } from "https://deno.land/x/denops_std@v3.9.1/mod.ts";
import { globalOptions } from "https://deno.land/x/denops_std@v3.9.1/variable/option.ts";
import * as bulk from "../windows-clipboard-history/bulk.ts";
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
  /** Highlight group name for control-chars. (default: "SpecialKey")
   *
   * If empty, highlight is disabled.
   */
  ctrlCharHlGroup: string;
};

type UserData = {
  text: string;
  word: string;
  suffix: string;
};

type Item = SetRequired<DdcItem<UserData>, "abbr" | "user_data">;

const ID = "ddc/source/windows-clipboard-history";
// deno-lint-ignore no-control-regex
const reControlChar = /[\x01-\x1f]/g;
const ctrlChars = 2; // "^@".length
const ctrlBytes = 2; // strlen("^@")

export class Source extends BaseSource<Params, UserData> {
  #clipboardHistory: ClipboardHistory | undefined;

  override params(): Params {
    return {
      pwsh: "powershell.exe",
      cacheExpires: 3000,
      maxAbbrWidth: 0,
      ctrlCharHlGroup: "SpecialKey",
    };
  }

  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    const { sourceParams: { pwsh, cacheExpires } } = args;
    this.#clipboardHistory = new ClipboardHistory({ pwsh, cacheExpires });
    await this.#clipboardHistory.waitInitialized();
  }

  override async gather(
    args: GatherArguments<Params>,
  ): Promise<DdcItem<UserData>[]> {
    if (!this.#clipboardHistory) {
      throw new Error("Object not initialized");
    }
    const {
      denops,
      context: { nextInput },
      sourceParams: { maxAbbrWidth, ctrlCharHlGroup },
      sourceOptions: { maxItems },
    } = args;

    const vimColumns = await globalOptions.get(denops, "columns", 9999);
    const abbrWidth = maxAbbrWidth > 0
      ? Math.min(maxAbbrWidth, vimColumns)
      : vimColumns;

    const recentHistory = (await this.#clipboardHistory.getHistory())
      .slice(0, Math.max(1, maxItems));
    const items = generateItems(recentHistory, nextInput);
    await truncateItemsAbbr(denops, items, abbrWidth);

    if (ctrlCharHlGroup) {
      await addItemsCtrlCharHighlights(denops, items, ctrlCharHlGroup);
    }

    return items;
  }

  override async onCompleteDone(
    args: OnCompleteDoneArguments<Params, UserData>,
  ): Promise<void> {
    const {
      denops,
      context: { input, nextInput, lineNr },
      userData: { text, word, suffix },
    } = args;
    const line = input + nextInput;
    const isConfirmed = line.endsWith(word + suffix);
    const hasCtrlChar = reControlChar.test(text);

    if (isConfirmed && hasCtrlChar) {
      const prefix = line.slice(0, line.length - word.length - suffix.length);
      const newText = prefix + text + suffix;
      const cursorCol = newText.length - nextInput.length;
      const prevText = newText.slice(0, cursorCol);
      const nextText = newText.slice(cursorCol);
      const lines = (prevText + nextText).split("\n");

      const prevLines = prevText.split("\n");
      const newLnum = lineNr + prevLines.length - 1;
      const newCol = await strlen(denops, prevLines.at(-1)) as number + 1;
      const newCursorPos = [0, newLnum, newCol, 0];

      await denops.call(
        "windows_clipboard_history#ddc#_insert",
        lineNr,
        lines,
        newCursorPos,
      );
    }
  }
}

function generateItems(
  history: ClipboardHistoryItem[],
  suffix: string,
): Item[] {
  const now = Date.now();
  return history.map((hist): Item => {
    const text = hist.Text.replaceAll("\r\n", "\n");
    const word = text.replaceAll(reControlChar, "?");
    const abbr = text.replaceAll("\n", "^@")
      .replaceAll(
        reControlChar,
        (c) => "^" + String.fromCharCode(c.charCodeAt(0) + 0x40),
      );
    const regType = text.endsWith("\n") ? "V" : "v";
    return {
      word,
      abbr,
      info: text,
      kind: regType,
      menu: toDuration(now - hist.Time),
      user_data: {
        text,
        word,
        suffix,
      },
    };
  });
}

async function truncateItemsAbbr(
  denops: Denops,
  items: Item[],
  maxWidth: number,
): Promise<void> {
  const truncated = await bulk.printf(
    denops,
    `%.${maxWidth}S`,
    items.map(({ abbr }) => abbr),
  );
  items.forEach((item, i) => {
    item.abbr = truncated[i];
  });
}

async function addItemsCtrlCharHighlights(
  denops: Denops,
  items: Item[],
  hlGroup: string,
): Promise<void> {
  const itemSlices = items.map((item) => ({
    item,
    slices: item.user_data.text.slice(0, item.abbr.length)
      .split(reControlChar).slice(0, -1),
  }));
  const sliceBytes = await bulk.strlen(
    denops,
    itemSlices.map(({ slices }) => slices).flat(),
  );
  let sliceBytesIndex = 0;
  const itemSliceBytes = itemSlices.map(({ item, slices }) => ({
    item,
    slices: slices.map((slice) => ({
      chars: slice.length,
      bytes: sliceBytes[sliceBytesIndex++],
    })),
  }));

  for (const { item, slices } of itemSliceBytes) {
    if (slices.length > 0) {
      item.highlights = generateCtrlCharHighlights(item.abbr, slices, hlGroup);
    }
  }
}

function generateCtrlCharHighlights(
  abbr: string,
  abbrSlices: { chars: number; bytes: number }[],
  hlGroup: string,
): PumHighlight[] {
  const highlights: PumHighlight[] = [];
  let lastHighlight: PumHighlight | undefined;
  let len = 0; // [chars]
  let col = 0; // [bytes]

  for (const { chars, bytes } of abbrSlices) {
    if (bytes === 0 && lastHighlight) {
      // increase width
      lastHighlight.width += ctrlBytes;
    } else {
      len += chars;
      col += bytes;
      if (len >= abbr.length) {
        break;
      }

      // add new highlight
      lastHighlight = {
        name: `${ID}/ctrlchar`,
        type: "abbr",
        hl_group: hlGroup,
        col,
        width: ctrlBytes,
      };
      highlights.push(lastHighlight);
    }

    len += ctrlChars;
    col += ctrlBytes;
    if (len >= abbr.length) {
      lastHighlight.width -= len - abbr.length;
      break;
    }
  }

  return highlights;
}
