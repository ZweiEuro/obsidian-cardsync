import { Buffer } from "buffer";
import { vCard } from "../../davparse/card/carddav.ts";
import { dataUriToBuffer, ParsedDataURI } from "data-uri-to-buffer";
import { App, TFile } from "obsidian";
import { creatBinaryOrGetFile } from "./util.ts";
// helper to deal with images

enum photo_encoding_t {
  b = "base64",
  base64 = "base64",
  B = "base64",
}

enum photo_type_t {
  "jpeg" = "jpg",
  "jpg" = "jpg",
  "png" = "png",
  "gif" = "gif",
  "bmp" = "bmp",
}

export function matchEncoding(str: string): photo_encoding_t | null {
  switch (str.toLowerCase()) {
    case "b":
    case "base64":
    case "B":
      return photo_encoding_t.base64;
  }

  return null;
}

export function matchType(str: string): photo_type_t | null {
  switch (str.toLowerCase()) {
    case "jpeg":
      return photo_type_t.jpg;
    case "jpg":
      return photo_type_t.jpg;
    case "png":
      return photo_type_t.png;
    case "gif":
      return photo_type_t.gif;
    case "bmp":
      return photo_type_t.bmp;
  }

  return null;
}

export function decodeImage(
  data: string,
  encoding: photo_encoding_t,
  type: photo_type_t,
) {
  try {
    const imageBuffer = Buffer.from(data, encoding);

    return {
      imageBuffer: imageBuffer as unknown as ArrayBuffer,
      size: imageBuffer.length,
      mimeType: `image/${type.toLowerCase()}`,
    };
  } catch (e) {
    console.warn("Could not decode image", e);
  }
  return null;
}

export async function createPhotoFile(app: App, card: vCard, cardFile: TFile) {
  const photo = card.get("PHOTO");

  if (!photo) return null;

  if (photo) {
    // first try if its a data URI
    const field_value = card.getSingleVal("PHOTO");
    if (!field_value) {
      console.warn("Photo value is null or empty");
      return null;
    }

    // our end result
    let image_file_data = null;

    // URI schemes
    let uri_data: null | ParsedDataURI = null;
    try {
      uri_data = dataUriToBuffer(field_value);
    } catch (_) {
      uri_data = null;
    }

    // try getting it from encoding params
    let fileEnding = null;

    if (uri_data) {
      image_file_data = uri_data.buffer;
      const fileEndingStr = uri_data.type.match(/image\/(\w*)/)?.at(1)!; // cleanup types

      fileEnding = matchType(fileEndingStr);
    } else if (
      card.getParam("PHOTO", "TYPE") && card.getParam("PHOTO", "ENCODING")
    ) {
      const encoding = card.getParam("PHOTO", "ENCODING")!;
      const type = card.getParam("PHOTO", "TYPE")!;

      const matched_encoding = matchEncoding(encoding);
      const matched_type = matchType(type);

      if (matched_encoding && matched_type) {
        const couldDecode = decodeImage(
          card.getSingleVal("PHOTO")!,
          matched_encoding,
          matched_type,
        );

        if (couldDecode) {
          image_file_data = couldDecode.imageBuffer;
        }
        fileEnding = matched_type;
      } else {
        console.warn("could not match encoding or type");
      }
    }
    // write it to file
    if (image_file_data) {
      if (!fileEnding) {
        console.warn("Could not get file ending for photo?");
        return null;
      }

      const path =
        `${cardFile.parent?.path}/${cardFile.basename}_photo.${fileEnding}`;

      const photo = await creatBinaryOrGetFile(app, path);

      await app.vault.modifyBinary(
        photo,
        image_file_data,
      );

      return { frontmatter: `[[${photo.name}]]`, file: photo };
    } else {
      console.warn("Could not parse image data");
    }
  }
  return null;
}
