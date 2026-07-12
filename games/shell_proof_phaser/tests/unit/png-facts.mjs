import { Buffer } from "node:buffer";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

/**
 * Read the intrinsic facts the catalog records without decoding image pixels.
 * Chunk framing matters: a payload containing the text "tRNS" is not a
 * transparency declaration unless those bytes are the type of a real chunk.
 *
 * @param {Buffer} bytes
 * @returns {{ width: number; height: number; hasAlpha: boolean }}
 */
export function pngFacts(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("expected PNG bytes");
  }

  let offset = 8;
  let width;
  let height;
  let colorType;
  let hasTransparencyChunk = false;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("truncated PNG chunk");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const nextOffset = dataStart + length + 4;
    if (nextOffset > bytes.length) throw new Error("truncated PNG chunk");

    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) throw new Error("PNG must begin with IHDR");
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      colorType = bytes.readUInt8(dataStart + 9);
      if (width === 0 || height === 0 || ![0, 2, 3, 4, 6].includes(colorType)) {
        throw new Error("invalid PNG IHDR facts");
      }
      sawHeader = true;
    } else if (type === "IHDR") {
      throw new Error("PNG contains multiple IHDR chunks");
    }

    if (type === "tRNS") {
      if (sawImageData) throw new Error("PNG tRNS chunk must precede IDAT");
      hasTransparencyChunk = true;
    } else if (type === "IDAT") {
      sawImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || nextOffset !== bytes.length) throw new Error("invalid PNG IEND chunk");
      sawEnd = true;
    }

    offset = nextOffset;
    if (sawEnd) break;
  }

  if (!sawHeader || !sawImageData || !sawEnd || width === undefined || height === undefined) {
    throw new Error("incomplete PNG chunk structure");
  }
  return {
    width,
    height,
    hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk,
  };
}
