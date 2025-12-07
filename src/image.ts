import { Buffer } from "buffer";
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
  switch (str) {
    case "b":
    case "base64":
    case "B":
      return photo_encoding_t.base64;
  }

  return null;
}

export function matchType(str: string): photo_type_t | null {
  switch (str) {
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
