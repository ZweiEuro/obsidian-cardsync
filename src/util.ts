import { Buffer } from "buffer";
import { App, FuzzySuggestModal, TFile, TFolder } from "obsidian";

export function authenticate(username: string, password: string) {
  return `Basic ${
    Buffer.from(`${username}:${password}`, "utf8").toString("base64")
  }`;
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  onChooseItemCb: (folder: TFolder) => void;

  constructor(app: App, onChooseItem: (folder: TFolder) => void) {
    super(app);
    this.onChooseItemCb = onChooseItem;
  }

  getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder);
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder, evt: MouseEvent | KeyboardEvent) {
    this.onChooseItemCb(folder);
  }
}

export async function findFileByFrontmatter(
  app: App,
  folderPath: string,
  frontmatterKey: string,
  frontmatterValue: string,
): Promise<TFile | null> {
  // Get all files in the vault
  const files = app.vault.getMarkdownFiles();

  // Filter files in the specific folder
  const filesInFolder = files.filter((file) =>
    file.path.startsWith(folderPath + "/")
  );

  // Search through files for matching frontmatter
  for (const file of filesInFolder) {
    const cache = app.metadataCache.getFileCache(file);

    if (cache?.frontmatter) {
      const value = cache.frontmatter[frontmatterKey] ??
        cache.frontmatter[frontmatterKey.toLowerCase()];

      // Check if value matches
      if (value === frontmatterValue) {
        return file;
      }
    }
  }

  return null;
}
