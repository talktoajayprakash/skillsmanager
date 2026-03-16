import { ensureAuth } from "../auth.js";
import { GDriveBackend } from "./gdrive.js";
import { GithubBackend } from "./github.js";
import { LocalBackend } from "./local.js";
import type { StorageBackend } from "./interface.js";

export async function resolveBackend(backendName: string): Promise<StorageBackend> {
  if (backendName === "gdrive") return new GDriveBackend(await ensureAuth());
  if (backendName === "github") return new GithubBackend();
  return new LocalBackend();
}
