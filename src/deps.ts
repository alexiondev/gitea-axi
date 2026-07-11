export interface GlobalFlags {
  repo?: string;
  login?: string;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  globals: GlobalFlags;
}
