import fs from "fs";
import path from "path";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { StorageBackend } from "./interface.js";
import type { CollectionFile, CollectionInfo, RegistryCollectionRef, RegistryFile, RegistryInfo } from "../types.js";
import {
  parseCollection, serializeCollection,
  parseRegistryFile, serializeRegistryFile,
  COLLECTION_FILENAME, LEGACY_COLLECTION_FILENAME, REGISTRY_FILENAME,
} from "../registry.js";
import { Readable } from "stream";
import { randomUUID } from "crypto";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export class GDriveBackend implements StorageBackend {
  private drive: ReturnType<typeof google.drive>;
  private oauth2: ReturnType<typeof google.oauth2>;

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: "v3", auth });
    this.oauth2 = google.oauth2({ version: "v2", auth });
  }

  async getOwner(): Promise<string> {
    const res = await this.oauth2.userinfo.get();
    return res.data.email ?? "";
  }

  // Alias for backwards compat
  async getOwnerEmail(): Promise<string> {
    return this.getOwner();
  }

  // ── Collection operations ────────────────────────────────────────────────

  async discoverCollections(): Promise<Omit<CollectionInfo, "id">[]> {
    const collections: Omit<CollectionInfo, "id">[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.drive.files.list({
        q: `(name='${COLLECTION_FILENAME}' or name='${LEGACY_COLLECTION_FILENAME}') and 'me' in owners and trashed=false`,
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
          name: rawName.replace(/^SKILLS_/i, ""),
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
      // Try new filename first, fall back to legacy
      for (const filename of [COLLECTION_FILENAME, LEGACY_COLLECTION_FILENAME]) {
        const res = await this.drive.files.list({
          q: `name='${filename}' and '${collection.folderId}' in parents and trashed=false`,
          fields: "files(id)",
          pageSize: 1,
        });
        fileId = res.data.files?.[0]?.id ?? undefined;
        if (fileId) break;
      }
      if (!fileId) {
        throw new Error(
          `Collection file not found in "${collection.name}"`
        );
      }
    }

    const res = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );

    return parseCollection(res.data as string);
  }

  async writeCollection(
    collection: CollectionInfo,
    data: CollectionFile
  ): Promise<void> {
    const content = serializeCollection(data);
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
      // Try to find existing file (new or legacy name)
      let existingId: string | undefined;
      for (const filename of [COLLECTION_FILENAME, LEGACY_COLLECTION_FILENAME]) {
        const res = await this.drive.files.list({
          q: `name='${filename}' and '${collection.folderId}' in parents and trashed=false`,
          fields: "files(id)",
          pageSize: 1,
        });
        existingId = res.data.files?.[0]?.id ?? undefined;
        if (existingId) break;
      }

      if (existingId) {
        await this.drive.files.update({ fileId: existingId, media });
      } else {
        await this.drive.files.create({
          requestBody: {
            name: COLLECTION_FILENAME,
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
    const logicalName = folderName.replace(/^SKILLS_/i, "");
    const emptyCollection: CollectionFile = { name: logicalName, owner, skills: [] };
    const content = serializeCollection(emptyCollection);
    const fileRes = await this.drive.files.create({
      requestBody: {
        name: COLLECTION_FILENAME,
        parents: [folderId],
      },
      media: { mimeType: "text/yaml", body: Readable.from(content) },
      fields: "id",
    });

    return {
      id: randomUUID(),
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

  // ── Registry operations ──────────────────────────────────────────────────

  async discoverRegistries(): Promise<Omit<RegistryInfo, "id">[]> {
    const registries: Omit<RegistryInfo, "id">[] = [];
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

        registries.push({
          name: (parent.data.name ?? "unknown").replace(/^SKILLS_/i, ""),
          backend: "gdrive",
          folderId: parentId,
          fileId: file.id ?? undefined,
        });
      }
    } while (pageToken);

    return registries;
  }

  async readRegistry(registry: RegistryInfo): Promise<RegistryFile> {
    let fileId = registry.fileId;

    if (!fileId) {
      const res = await this.drive.files.list({
        q: `name='${REGISTRY_FILENAME}' and '${registry.folderId}' in parents and trashed=false`,
        fields: "files(id)",
        pageSize: 1,
      });
      fileId = res.data.files?.[0]?.id ?? undefined;
      if (!fileId) {
        throw new Error(`Registry file not found for "${registry.name}"`);
      }
    }

    const res = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );

    return parseRegistryFile(res.data as string);
  }

  async writeRegistry(registry: RegistryInfo, data: RegistryFile): Promise<void> {
    const content = serializeRegistryFile(data);
    const media = { mimeType: "text/yaml", body: Readable.from(content) };

    if (registry.fileId) {
      await this.drive.files.update({ fileId: registry.fileId, media });
    } else {
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
          requestBody: { name: REGISTRY_FILENAME, parents: [registry.folderId] },
          media,
        });
      }
    }
  }

  async resolveCollectionRef(ref: RegistryCollectionRef): Promise<Omit<CollectionInfo, "id"> | null> {
    if (ref.backend !== "gdrive") return null;

    // Search for folder by name (try with SKILLS_ prefix and without)
    const names = ref.ref.startsWith("SKILLS_") ? [ref.ref] : [`SKILLS_${ref.ref}`, ref.ref];

    for (const name of names) {
      const res = await this.drive.files.list({
        q: `name='${name}' and mimeType='${FOLDER_MIME}' and 'me' in owners and trashed=false`,
        fields: "files(id, name)",
        pageSize: 1,
      });

      const folder = res.data.files?.[0];
      if (folder?.id) {
        return {
          name: (folder.name ?? name).replace(/^SKILLS_/i, ""),
          backend: "gdrive",
          folderId: folder.id,
        };
      }
    }

    return null;
  }

  async createRegistry(name?: string): Promise<RegistryInfo> {
    const folderName = name ? `SKILLS_REGISTRY_${name}` : "SKILLS_REGISTRY";

    const folderRes = await this.drive.files.create({
      requestBody: { name: folderName, mimeType: FOLDER_MIME },
      fields: "id, name",
    });
    const folderId = folderRes.data.id!;

    const owner = await this.getOwnerEmail();
    const registryData: RegistryFile = {
      name: name ?? "default",
      owner,
      source: "gdrive",
      collections: [],
    };

    const fileRes = await this.drive.files.create({
      requestBody: { name: REGISTRY_FILENAME, parents: [folderId] },
      media: { mimeType: "text/yaml", body: Readable.from(serializeRegistryFile(registryData)) },
      fields: "id",
    });

    return {
      id: randomUUID(),
      name: name ?? "default",
      backend: "gdrive",
      folderId,
      fileId: fileRes.data.id ?? undefined,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

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
