import fs from "fs";
import path from "path";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { StorageBackend } from "./interface.js";
import type { RegistryFile, RegistryInfo } from "../types.js";
import { parseRegistry, serializeRegistry } from "../registry.js";
import { Readable } from "stream";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const REGISTRY_FILENAME = "SKILLS_SYNC.yaml";

export class GDriveBackend implements StorageBackend {
  private drive: ReturnType<typeof google.drive>;

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: "v3", auth });
  }

  async discoverRegistries(): Promise<RegistryInfo[]> {
    const registries: RegistryInfo[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.drive.files.list({
        q: `name='${REGISTRY_FILENAME}' and 'me' in owners and trashed=false`,
        fields: "nextPageToken, files(id, name, parents)",
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });

      pageToken = res.data.nextPageToken ?? undefined;

      for (const file of res.data.files ?? []) {
        const parentId = file.parents?.[0];
        if (!parentId) continue;

        // Get the parent folder name
        const parent = await this.drive.files.get({
          fileId: parentId,
          fields: "id, name",
        });

        registries.push({
          name: parent.data.name ?? "unknown",
          backend: "gdrive",
          folderId: parentId,
          registryFileId: file.id ?? undefined,
        });
      }
    } while (pageToken);

    return registries;
  }

  async readRegistry(registry: RegistryInfo): Promise<RegistryFile> {
    let fileId = registry.registryFileId;

    if (!fileId) {
      // Find SKILLS_SYNC.yaml in the folder
      const res = await this.drive.files.list({
        q: `name='${REGISTRY_FILENAME}' and '${registry.folderId}' in parents and trashed=false`,
        fields: "files(id)",
        pageSize: 1,
      });
      fileId = res.data.files?.[0]?.id ?? undefined;
      if (!fileId) {
        throw new Error(
          `SKILLS_SYNC.yaml not found in registry "${registry.name}"`
        );
      }
    }

    const res = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );

    return parseRegistry(res.data as string);
  }

  async writeRegistry(
    registry: RegistryInfo,
    data: RegistryFile
  ): Promise<void> {
    const content = serializeRegistry(data);
    const media = {
      mimeType: "text/yaml",
      body: Readable.from(content),
    };

    if (registry.registryFileId) {
      await this.drive.files.update({
        fileId: registry.registryFileId,
        media,
      });
    } else {
      // Find existing or create new
      const res = await this.drive.files.list({
        q: `name='${REGISTRY_FILENAME}' and '${registry.folderId}' in parents and trashed=false`,
        fields: "files(id)",
        pageSize: 1,
      });

      const existingId = res.data.files?.[0]?.id;
      if (existingId) {
        await this.drive.files.update({ fileId: existingId, media });
      } else {
        await this.drive.files.create({
          requestBody: {
            name: REGISTRY_FILENAME,
            parents: [registry.folderId],
          },
          media,
        });
      }
    }
  }

  async downloadSkill(
    registry: RegistryInfo,
    skillName: string,
    destDir: string
  ): Promise<void> {
    // Find the skill folder in Drive
    const res = await this.drive.files.list({
      q: `name='${skillName}' and '${registry.folderId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: "files(id, name)",
      pageSize: 1,
    });

    const skillFolder = res.data.files?.[0];
    if (!skillFolder?.id) {
      throw new Error(
        `Skill folder "${skillName}" not found in registry "${registry.name}"`
      );
    }

    // Download all files recursively
    await this.downloadFolder(skillFolder.id, destDir);
  }

  private async downloadFolder(folderId: string, destDir: string): Promise<void> {
    fs.mkdirSync(destDir, { recursive: true });

    let pageToken: string | undefined;
    do {
      const res = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "nextPageToken, files(id, name, mimeType)",
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });

      pageToken = res.data.nextPageToken ?? undefined;

      for (const file of res.data.files ?? []) {
        if (file.mimeType === FOLDER_MIME) {
          await this.downloadFolder(
            file.id!,
            path.join(destDir, file.name!)
          );
        } else {
          const filePath = path.join(destDir, file.name!);
          const fileRes = await this.drive.files.get(
            { fileId: file.id!, alt: "media" },
            { responseType: "stream" }
          );
          await new Promise<void>((resolve, reject) => {
            const dest = fs.createWriteStream(filePath);
            (fileRes.data as NodeJS.ReadableStream).pipe(dest);
            dest.on("finish", resolve);
            dest.on("error", reject);
          });
        }
      }
    } while (pageToken);
  }

  async createRegistry(folderName: string): Promise<RegistryInfo> {
    // Create the folder in Drive root
    const folderRes = await this.drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: FOLDER_MIME,
      },
      fields: "id, name",
    });
    const folderId = folderRes.data.id!;

    // Create empty SKILLS_SYNC.yaml inside it
    const emptyRegistry: RegistryFile = { name: folderName, owner: "", skills: [] };
    const content = serializeRegistry(emptyRegistry);
    const fileRes = await this.drive.files.create({
      requestBody: {
        name: REGISTRY_FILENAME,
        parents: [folderId],
      },
      media: { mimeType: "text/yaml", body: Readable.from(content) },
      fields: "id",
    });

    return {
      name: folderName,
      backend: "gdrive",
      folderId,
      registryFileId: fileRes.data.id ?? undefined,
    };
  }

  async uploadSkill(
    registry: RegistryInfo,
    localPath: string,
    skillName: string
  ): Promise<void> {
    // Find or create skill folder
    let folderId = await this.findFolder(skillName, registry.folderId);
    if (!folderId) {
      const res = await this.drive.files.create({
        requestBody: {
          name: skillName,
          mimeType: FOLDER_MIME,
          parents: [registry.folderId],
        },
        fields: "id",
      });
      folderId = res.data.id!;
    }

    // Upload all files from local path
    await this.uploadFolder(localPath, folderId);
  }

  private async findFolder(
    name: string,
    parentId: string
  ): Promise<string | null> {
    const res = await this.drive.files.list({
      q: `name='${name}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: "files(id)",
      pageSize: 1,
    });
    return res.data.files?.[0]?.id ?? null;
  }

  private async uploadFolder(
    localDir: string,
    parentId: string
  ): Promise<void> {
    for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(localDir, entry.name);

      if (entry.isDirectory()) {
        let subFolderId = await this.findFolder(entry.name, parentId);
        if (!subFolderId) {
          const res = await this.drive.files.create({
            requestBody: {
              name: entry.name,
              mimeType: FOLDER_MIME,
              parents: [parentId],
            },
            fields: "id",
          });
          subFolderId = res.data.id!;
        }
        await this.uploadFolder(fullPath, subFolderId);
      } else {
        // Check if file already exists
        const existing = await this.drive.files.list({
          q: `name='${entry.name}' and '${parentId}' in parents and trashed=false`,
          fields: "files(id)",
          pageSize: 1,
        });

        const media = {
          mimeType: "application/octet-stream",
          body: fs.createReadStream(fullPath),
        };

        if (existing.data.files?.[0]?.id) {
          await this.drive.files.update({
            fileId: existing.data.files[0].id,
            media,
          });
        } else {
          await this.drive.files.create({
            requestBody: { name: entry.name, parents: [parentId] },
            media,
          });
        }
      }
    }
  }
}
