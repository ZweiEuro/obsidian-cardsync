import { App, TFile } from "obsidian";

export async function getRelevantCardInfoFromFile(app: App, file: TFile) {
  let cardUrl: string | null = null;
  let aliases: string[] | null = null as null | string[];
  let categories: string | string[] | null = null as
    | null
    | string[]
    | string;

  await app.fileManager.processFrontMatter(file, (fm) => {
    aliases = fm["aliases"] ?? null;
    categories = fm["tags"] ?? null;
    cardUrl = fm["obs_sync_url"] ?? null;
  });

  return {
    cardUrl,
    aliases,
    categories,
    note: await parseNoteFromFile(app, file),
  };
}

export async function parseNoteFromFile(app: App, file: TFile) {
  const content = await app.vault.read(file);
  const split = content.split("---\n");
  return split.at(2);
}
