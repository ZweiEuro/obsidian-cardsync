import { Buffer } from "node:buffer";
import { App, FuzzySuggestModal, TFile, TFolder } from "obsidian";

// FIXME: Make a wrapper class around a single card.
// Main benefit: make getters that ignore internal casing since apparently thats not standard
export type card_t = Record<string, { value: string | string[] }[] | undefined>;

// assume that the key opens a prop, the prop only exists once and has only one value
// that value has only one entry in its array.
// Then get that value
export function getSingleProp(
  card: card_t,
  key: string,
) {
  key = key.toLowerCase();
  if (Array.isArray(card)) return null;

  const prop = card[key] ?? card[key.toUpperCase()];

  if (prop && prop.length === 1) {
    const propVal = prop.at(0);

    if (
      propVal &&
      !Array.isArray(propVal.value)
    ) {
      return propVal.value ?? null;
    }
  }

  return null;
}

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
