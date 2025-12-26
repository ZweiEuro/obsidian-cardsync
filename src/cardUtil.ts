import { vCard } from "@zweieuro/davparse";
import { App, TFile } from "obsidian";
import { createPhotoFile } from "./image.ts";

export async function vCardFromFile(app: App, file: TFile) {
  const card = new vCard();

  const noteSection = await parseNoteFromFile(app, file);

  if (noteSection) {
    card.set({
      value: noteSection,
      propName: "note",
      groupName: null,
      params: [],
    });
  }

  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const key of Object.keys(fm)) {
      const value = fm[key] as string | string[];

      if (!value) {
        console.warn(
          "file value with key",
          key,
          "evaluates to false. This is skipped (null/undefined catch) value: ",
          value,
        );
        continue;
      }

      // skip any key that has a shape of a param from us:
      const param_check_regex = /^.+_PARAM_.+$/;
      if (param_check_regex.test(key)) {
        continue;
      }

      switch (key) {
        case "aliases": {
          const propName = "X-CUSTOM1";
          card.set({
            propName: propName,
            groupName: null,
            params: [],
            value: Array.isArray(value) ? value.join(",") : value,
          });

          const param_regex = new RegExp(`^${propName}_PARAM_(.+)$`);
          for (const paramKey of Object.keys(fm)) {
            const match = param_regex.exec(paramKey);

            if (match) {
              card.setParam(propName, match[1], fm[match[0]]);
            }
          }

          break;
        }
        case "tags": {
          {
            if (Array.isArray(value)) {
              card.set({
                propName: "categories",
                groupName: null,
                params: [],
                value: {
                  listVals: value,
                  valueListDelim: ",",
                },
              });
            } else {
              card.set({
                propName: "categories",
                groupName: null,
                params: [],
                value: value,
              });
            }

            const propName = "CATEGORIES";

            const param_regex = new RegExp(`^${propName}_PARAM_(.+)$`);
            for (const paramKey of Object.keys(fm)) {
              const match = param_regex.exec(paramKey);

              if (match) {
                card.setParam(key, match[1], fm[match[0]]);
              }
            }
          }

          break;
        }

        default: {
          if (Array.isArray(value)) {
            card.set({
              propName: key,
              groupName: null,
              params: [],
              value: { listVals: value, valueListDelim: "," },
            });
          } else {
            card.set({
              propName: key,
              groupName: null,
              params: [],
              value: value,
            });
          }

          // find all the params for this key:
          const param_regex = new RegExp(`^${key}_PARAM_(.+)$`);
          for (const paramKey of Object.keys(fm)) {
            const match = param_regex.exec(paramKey);

            if (match) {
              card.setParam(key, match[1], fm[match[0]]);
            }
          }
        }
      }
    }
  });

  return card;
}

export async function vCardToFile(
  app: App,
  file: TFile,
  parsed: vCard,
): Promise<{ contactPhoto: null | TFile }> {
  // NOTE: Anything that may be "async" must be done beforehand
  // cant modify while editing fontmatter, race condition
  const contactPhoto = await createPhotoFile(app, parsed, file);

  const note = parsed.getSingleVal("NOTE");
  if (note) {
    await app.vault.modify(
      file,
      parsed.getSingleVal("note") ?? "",
    );
  } else {
    // create the note field anyways
    await app.vault.modify(file, ``);
  }

  //NOTE: DO NOT make this async, for some reason some thing break.
  // Seems that obsidian is partially updating the fontmatter, making this object invalid during the process. which is not exactly good
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const propKey of parsed.get_data().keys()) {
      // map the prop into a single value or an array
      const propValue = parsed.get(propKey);
      if (
        !propValue ||
        (typeof propValue.value !== "string" &&
          propValue.value.listVals.length === 0)
      ) {
        continue;
      }
      delete fm[propKey];

      switch (propKey) {
        case "X-CUSTOM1":
          fm["aliases"] = parsed.getSingleVal("X-CUSTOM1")!.split(",");
          break;
        case "CATEGORIES": {
          const categories = propValue.value;
          if (typeof categories === "string") {
            fm["tags"] = categories;
          } else {
            fm["tags"] = categories.listVals;
          }
          break;
        }
        case "NOTE": {
          //skip, parsed beforehand
          break;
        }
        case "PHOTO": {
          if (contactPhoto) {
            fm[propKey] = contactPhoto.frontmatter_photo_text;
          }
          break;
        }
        default:
          if (typeof propValue.value === "string") {
            fm[propKey] = propValue.value;
          } else {
            fm[propKey] = propValue.value.listVals;
          }
      }

      if (propValue.params) {
        for (const param of propValue.params) {
          fm[`${propKey}_PARAM_${param.paramName}`] = param.paramValStr;
        }
      }
    }
  });

  return { contactPhoto: contactPhoto?.file ?? null };
}

export function hasRelaventCardDiff(a: vCard, b: vCard) {
  const diff = a.diff(b);

  if (diff.length === 0) {
    return false;
  } else if (diff.length === 1 && diff.at(0)!.propName === "PHOTO") {
    return false;
  }
  return true;
}

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
    cardUrl = fm["OBS_SYNC_URL"] ?? null;
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
