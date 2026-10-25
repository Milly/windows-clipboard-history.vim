export type Params = {
  /** PowerShell executable path. (default: "powershell.exe") */
  pwsh: string;
  /** Cache expires interval. (default: 3000 [msec]) */
  cacheExpires: number;
  /** Highlight group name for header. (default: "Special")
   *
   * If empty, highlight is disabled.
   */
  headerHlGroup: string;
  /** Prefix for displayed items. (default: "") */
  prefix: string;
};
