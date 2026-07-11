declare module "zstd-codec" {
  type ZstdSimple = {
    compress: (data: Uint8Array, level?: number) => Uint8Array;
    decompress: (data: Uint8Array) => Uint8Array;
  };
  type ZstdApi = {
    Simple: new () => ZstdSimple;
  };
  export const ZstdCodec: {
    run: (cb: (zstd: ZstdApi) => void) => void;
  };
}
