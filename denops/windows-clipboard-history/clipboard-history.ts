import { deadline } from "https://deno.land/std@0.165.0/async/deadline.ts";
import { deferred } from "https://deno.land/std@0.165.0/async/deferred.ts";
import * as path from "https://deno.land/std@0.165.0/path/mod.ts";
import { JSONDecodeStream } from "./json.ts";

const __dirname = path.dirname(path.fromFileUrl(import.meta.url));

const DEFAULT_PWSH_EXECUTABLE = "powershell.exe";
const DEFAULT_CACHE_EXPIRES = 3000;
const PS_MODULE_PATHS = [
  path.join(__dirname, "clipboard-history.psm1"),
  path.join(__dirname, "safe-json.psm1"),
];
const CLIPBOARD_HISTORY_COMMAND =
  "ConvertTo-SafeEncodeJson @(Get-ClipboardHistory) -Compress";
const PROCESS_INITIALIZE_MAX_RETRY_COUNT = 1;
const PROCESS_CLOSE_TIMEOUT = 500;

export type ClipboardHistoryOptions = {
  /** PowerShell executable path. (default: "powershell.exe") */
  pwsh?: string;
  /** Cache expires interval. (default: 3000 [msec]) */
  cacheExpires?: number;
};

export type ClipboardHistoryItem = {
  Id: string;
  Text: string;
  Time: number;
};

export class ClipboardHistory {
  #initialized;
  #pwsh: string;
  #cacheExpires: number;
  #processInfo: PSProcessInfo | undefined;
  #lastHistory: ClipboardHistoryItem[] | undefined;
  #lastCachedTime: number;

  constructor(opts: ClipboardHistoryOptions = {}) {
    this.#pwsh = opts.pwsh ?? DEFAULT_PWSH_EXECUTABLE;
    this.#cacheExpires = opts.cacheExpires ?? DEFAULT_CACHE_EXPIRES;
    this.#lastCachedTime = 0;
    this.#initialized = deferred<void>();
    this.#initialized.resolve(this.#tryWaitInitProcess());
  }

  dispose(): Promise<void> {
    if (this.#initialized.state !== "pending") {
      this.#initialized = deferred<void>();
    }
    this.#initialized.reject(new Error("Object disposed"));
    return this.#closeProcess();
  }

  async waitInitialized(): Promise<void> {
    return await this.#initialized;
  }

  async getHistory(): Promise<ClipboardHistoryItem[]> {
    const now = Date.now();
    if (
      !this.#lastHistory || (now - this.#lastCachedTime) >= this.#cacheExpires
    ) {
      if (this.#initialized.state === "rejected") {
        await this.#tryWaitInitProcess();
        this.#initialized.resolve();
      } else {
        await this.#initialized;
      }
      await this.#writeCommand("\n");
      this.#lastHistory = await this.#readJSON();
      this.#lastCachedTime = now;
    }
    return this.#lastHistory.map((h) => ({ ...h })); // deep cloned
  }

  async #tryWaitInitProcess(): Promise<void> {
    for (let count = 0;; ++count) {
      try {
        return await this.#initProcess();
      } catch (e: unknown) {
        if (count >= PROCESS_INITIALIZE_MAX_RETRY_COUNT) {
          throw e;
        }
      }
    }
  }

  async #initProcess(): Promise<void> {
    if (this.#processInfo) {
      throw new Error("Already process started");
    }

    const command = [
      `Import-Module @(${
        PS_MODULE_PATHS.map((path) => `"${path}"`).join(", ")
      })`,
      "'[]'", // initial data
      `while ((Read-Host) -eq '') { ${CLIPBOARD_HISTORY_COMMAND} }`,
    ].join(";");
    const process = Deno.run({
      cmd: [this.#pwsh, "-NoProfile", "-Command", command],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    });

    const readStream = process.stdout.readable.pipeThrough(
      new TextDecoderStream(),
    ).pipeThrough(new JSONDecodeStream());
    const reader = readStream.getReader();

    const writeStream = new TextEncoderStream();
    writeStream.readable.pipeTo(process.stdin.writable);
    const writer = writeStream.writable.getWriter();

    this.#processInfo = { process, reader, writer };
    process.status().finally(() => this.#closeProcess());

    // wait initial data
    await this.#readJSON();
  }

  async #closeProcess(): Promise<void> {
    const p = this.#processInfo;
    this.#processInfo = undefined;
    if (p) {
      await this.#writeCommand("exit\n").finally(() =>
        Promise.allSettled([
          p.writer.close(),
          p.reader.cancel(),
          p.process.stdout?.close(),
          p.process.stdin?.close(),
        ])
      ).catch();
      try {
        await deadline(p.process.status(), PROCESS_CLOSE_TIMEOUT);
      } catch (_) {
        p.process.kill();
      }
      p.process.close();
    }
  }

  async #writeCommand(command: string): Promise<void> {
    await this.#withProcess(async (p) => {
      await p.writer.ready;
      await p.writer.write(command);
      await p.writer.ready;
    });
  }

  async #readJSON(): Promise<ClipboardHistoryItem[]> {
    const { done, value } = await this.#withProcess((p) => p.reader.read());
    if (done) {
      throw new Error("Unexpected stream EOF");
    }
    if (!Array.isArray(value)) {
      throw new Error(`Invalid result: ${value}`);
    }
    return value;
  }

  async #withProcess<T = unknown>(
    proc: (p: PSProcessInfo) => Promise<T> | T,
  ): Promise<T> {
    const p = this.#processInfo;
    if (p) {
      const res = await Promise.race([proc(p), p.process.status()]);
      if (!isProcessStatus(res)) {
        return res;
      }
    }
    throw new Error("Process not exist");
  }
}

interface PSProcessInfo {
  process: Deno.Process;
  reader: ReadableStreamDefaultReader<unknown>;
  writer: WritableStreamDefaultWriter<string>;
}

function isProcessStatus(obj: unknown): obj is Deno.ProcessStatus {
  if (typeof obj === "object") {
    const { success, code } = obj as Deno.ProcessStatus;
    return typeof success === "boolean" && typeof code === "number";
  }
  return false;
}
