/**
 * zstd compress wrapper for openfig message chunk 1.
 * openfig-core only decompresses (fzstd); Figma requires zstd on write.
 */

type ZstdSimple = {
  compress: (data: Uint8Array, level?: number) => Uint8Array;
};
type ZstdCodecNs = {
  run: (cb: (zstd: { Simple: new () => ZstdSimple }) => void) => void;
};

let codecPromise: Promise<ZstdCodecNs> | undefined;

async function loadZstdCodec(): Promise<ZstdCodecNs> {
  if (!codecPromise) {
    codecPromise = (async () => {
      const mod = (await import("zstd-codec")) as {
        ZstdCodec?: ZstdCodecNs;
        default?: { ZstdCodec?: ZstdCodecNs };
      };
      const codec = mod.ZstdCodec ?? mod.default?.ZstdCodec;
      if (!codec?.run) {
        throw new Error("zstd-codec: ZstdCodec.run not found");
      }
      return codec;
    })();
  }
  return codecPromise;
}

/** Compress bytes with zstd level 3 (Figma-compatible). */
export async function zstdCompress(
  data: Uint8Array,
  level = 3,
): Promise<Uint8Array> {
  const codec = await loadZstdCodec();
  return new Promise((resolve, reject) => {
    try {
      codec.run((zstd) => {
        try {
          const simple = new zstd.Simple();
          resolve(simple.compress(data, level));
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
