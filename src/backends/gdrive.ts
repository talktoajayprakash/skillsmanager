import fs from "fs";
import path from "path";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { StorageBackend } from "./interface.js";
import type { CollectionFile, CollectionInfo } from "../types.js";
import { parseRegistry, serializeRegistry } from "../registry.js";
import { Readable } from "stream";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const REGISTRY_FILENAME = "SKILLS_SYNC.yaml";

export class GDriveBackend implements StorageBackend {
  private drive: ReturnType<typeof google.drive>;
  private oauth2: ReturnType<typeof google.oauth2>;

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: "v3", auth });
    this.oauth2 = google.oauth2({ version: "v2", auth });
  }

  async getOwnerEmail(): Promise<string> {
    const res = await this.oauth2.userinfo.get();
    return res.data.email ?? "";
  }

  async discoverCollections(): Promise<CollectionInfo[]> {
    const collections: CollectionInfo[] = [];
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

        const parent = await this.drive.files.get({
          fileId: parentId,
          fields: "id, name",
        });

        const rawName = parent.data.name ?? "unknown";
        collections.push({
          name: rawName.replace(/^SKILLSYNC_/i, ""),
          backend: "gdrive",
          folderId: parentId,
          registryFileId: file.id ?? undefined,
        });
      }
    } while (pageToken);

    return collections;
  }

  async readCollection(collection: CollectionInfo): Promise<CollectionFile> {
    let fileId = collection.registryFileId;

    if (!fileId) {
      const res = await this.drive.files.list({
        q: `name='${REGISTRY_FILENAME}' and '${collection.folderId}' in parents and trashed=false`,
        fields: "files(id)",
        pageSize: 1,
      });
      fileId = res.data.files?.[0]?.id ?? undefined;
      if (!fileId) {
        throw new Error(
          `SKILLS_SYNC.yaml not found in collection "${collection.name}"`
        );
      }
    }

    const res = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );

    return parseRegistry(res.data as string);
  }

  async writeCollection(
    collection: CollectionInfo,
    data: CollectionFile
  ): Promise<void> {
    const content = serializeRegistry(data);
    const media = {
      mimeType: "text/yaml",
      body: Readable.from(content),
    };

    if (collection.registryFileId) {
      await this.drive.files.update({
        fileId: collection.registryFileId,
        media,
      });
    } else {
      const res = await this.drive.files.list({
        q: `name='${REGISTRY_FILENAME}' and '${collection.folderId}' in parents and trashed=false`,
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
            parents: [collection.folderId],
          },
          media,
        });
      }
    }
  }

  async downloadSkill(
    collection: CollectionInfo,
    skillName: string,
    destDir: string
  ): Promise<void> {
    const res = await this.drive.files.list({
      q: `name='${skillName}' and '${collection.folderId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: "files(id, name)",
      pageSize: 1,
    });

    const skillFolder = res.data.files?.[0];
    if (!skillFolder?.id) {
      throw new Error(
        `Skill folder "${skillName}" not found in collection "${collection.name}"`
      );
    }

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

  async createCollection(folderName: string): Promise<CollectionInfo> {
    const folderRes = await this.drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: FOLDER_MIME,
      },
      fields: "id, name",
    });
    const folderId = folderRes.data.id!;

    const owner = await this.getOwnerEmail();
    // Strip the SKILLSYNC_ prefix for the logical name stored in the YAML
    const logicalName = folderName.replace(/^SKILLSYNC_/i, "");
    const emptyCollection: CollectionFile = { name: logicalName, owner, skills: [] };
    const content = serializeRegistry(emptyCollection);
    const fileRes = await this.drive.files.create({
      requestBody: {
        name: REGISTRY_FILENAME,
        parents: [folderId],
      },
      media: { mimeType: "text/yaml", body: Readable.from(content) },
      fields: "id",
    });

    return {
      name: logicalName,
      backend: "gdrive",
      folderId,
      registryFileId: fileRes.data.id ?? undefined,
    };
  }

  async uploadSkill(
    collection: CollectionInfo,
    localPath: string,
    skillName: string
  ): Promise<void> {
    let folderId = await this.findFolder(skillName, collection.folderId);
    if (!folderId) {
      const res = await this.drive.files.create({
        requestBody: {
          name: skillName,
          mimeType: FOLDER_MIME,
          parents: [collection.folderId],
        },
        fields: "id",
      });
      folderId = res.data.id!;
    }

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
