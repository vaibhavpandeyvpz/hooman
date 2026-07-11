/**
 * Screenshot-backed Sketch (.sketch) writer.
 * Same idea as PPTX: one full-bleed artboard per page with a pattern image fill.
 */

import { createHash, randomUUID } from "node:crypto";
import { zipSync } from "fflate";
import * as FileFormat from "@sketch-hq/sketch-file-format-ts/dist/esm/types.js";
import { deflateSync } from "node:zlib";
import type { RenderedPage } from "./export-design.js";

function sketchId(): string {
  return randomUUID().toUpperCase();
}

function createPlaceholderPng(
  width = 400,
  height = 260,
  rgb: [number, number, number] = [0xf5, 0xf7, 0xfa],
): Uint8Array {
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0;
  for (let x = 0; x < width; x++) {
    const o = 1 + x * 3;
    row[o] = rgb[0];
    row[o + 1] = rgb[1];
    row[o + 2] = rgb[2];
  }
  const raw = Buffer.alloc(height * row.length);
  for (let i = 0; i < height; i++) {
    row.copy(raw, i * row.length);
  }
  const idat = deflateSync(raw);
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) {
      c = (crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)) >>> 0;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      sig,
      chunk("IHDR", ihdr),
      chunk("IDAT", idat),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const DEFAULT_EXPORT_OPTIONS = {
  _class: "exportOptions" as const,
  includedLayerIds: [] as string[],
  layerOptions: 0,
  shouldTrim: false,
  exportFormats: [] as unknown[],
};

const DEFAULT_RULER = {
  _class: "rulerData" as const,
  base: 0,
  guides: [] as unknown[],
};

function emptyStyle(opacity = 1) {
  return {
    _class: "style" as const,
    do_objectID: sketchId(),
    endMarkerType: FileFormat.MarkerType.OpenArrow,
    miterLimit: 10,
    startMarkerType: FileFormat.MarkerType.OpenArrow,
    windingRule: FileFormat.WindingRule.EvenOdd,
    blur: {
      _class: "blur" as const,
      isEnabled: false,
      center: "{0.5, 0.5}",
      motionAngle: 0,
      radius: 10,
      saturation: 1,
      type: FileFormat.BlurType.Gaussian,
    },
    borderOptions: {
      _class: "borderOptions" as const,
      isEnabled: true,
      dashPattern: [] as number[],
      lineCapStyle: FileFormat.LineCapStyle.Butt,
      lineJoinStyle: FileFormat.LineJoinStyle.Miter,
    },
    borders: [] as unknown[],
    colorControls: {
      _class: "colorControls" as const,
      isEnabled: false,
      brightness: 0,
      contrast: 1,
      hue: 0,
      saturation: 1,
    },
    contextSettings: {
      _class: "graphicsContextSettings" as const,
      blendMode: FileFormat.BlendMode.Normal,
      opacity,
    },
    fills: [] as unknown[],
    innerShadows: [] as unknown[],
    shadows: [] as unknown[],
  };
}

function emptyGradient() {
  return {
    _class: "gradient" as const,
    elipseLength: 0,
    from: "{0.5, 0}",
    gradientType: FileFormat.GradientType.Linear,
    to: "{0.5, 1}",
    stops: [
      {
        _class: "gradientStop" as const,
        position: 0,
        color: {
          _class: "color" as const,
          red: 0,
          green: 0,
          blue: 0,
          alpha: 1,
        },
      },
      {
        _class: "gradientStop" as const,
        position: 1,
        color: {
          _class: "color" as const,
          red: 0,
          green: 0,
          blue: 0,
          alpha: 1,
        },
      },
    ],
  };
}

function cornerPoints(_w: number, _h: number) {
  return [
    {
      _class: "curvePoint" as const,
      cornerRadius: 0,
      cornerStyle: FileFormat.CornerStyle.Rounded,
      curveFrom: "{0, 0}",
      curveTo: "{0, 0}",
      hasCurveFrom: false,
      hasCurveTo: false,
      point: "{0, 0}",
    },
    {
      _class: "curvePoint" as const,
      cornerRadius: 0,
      cornerStyle: FileFormat.CornerStyle.Rounded,
      curveFrom: "{1, 0}",
      curveTo: "{1, 0}",
      hasCurveFrom: false,
      hasCurveTo: false,
      point: "{1, 0}",
    },
    {
      _class: "curvePoint" as const,
      cornerRadius: 0,
      cornerStyle: FileFormat.CornerStyle.Rounded,
      curveFrom: "{1, 1}",
      curveTo: "{1, 1}",
      hasCurveFrom: false,
      hasCurveTo: false,
      point: "{1, 1}",
    },
    {
      _class: "curvePoint" as const,
      cornerRadius: 0,
      cornerStyle: FileFormat.CornerStyle.Rounded,
      curveFrom: "{0, 1}",
      curveTo: "{0, 1}",
      hasCurveFrom: false,
      hasCurveTo: false,
      point: "{0, 1}",
    },
  ];
}

/**
 * Screenshot pages → simple `.sketch` (one artboard per page, image pattern fill).
 */
export function buildScreenshotSketch(
  images: RenderedPage[],
  opts: { title?: string } = {},
): Buffer {
  if (images.length === 0) {
    throw new Error("no pages to export");
  }
  const title = opts.title ?? "Untitled";
  const pageId = sketchId();
  const documentId = sketchId();
  const imagesMap = new Map<string, Uint8Array>();
  const artboards: Record<string, unknown>[] = [];
  const artboardMeta: Record<string, { name: string }> = {};
  let cursorX = 0;
  const gap = 80;

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const bytes = new Uint8Array(img.buffer);
    const sha1 = createHash("sha1").update(bytes).digest("hex");
    imagesMap.set(sha1, bytes);
    const imageRef = {
      _class: "MSJSONFileReference" as const,
      _ref_class: "MSImageData" as const,
      _ref: `images/${sha1}`,
    };
    const fillStyle = emptyStyle(1);
    fillStyle.fills = [
      {
        _class: "fill",
        isEnabled: true,
        fillType: FileFormat.FillType.Pattern,
        color: {
          _class: "color",
          red: 0,
          green: 0,
          blue: 0,
          alpha: 1,
        },
        contextSettings: {
          _class: "graphicsContextSettings",
          blendMode: FileFormat.BlendMode.Normal,
          opacity: 1,
        },
        gradient: emptyGradient(),
        image: imageRef,
        noiseIndex: 0,
        noiseIntensity: 0,
        patternFillType: FileFormat.PatternFillType.Fill,
        patternTileScale: 1,
      },
    ];

    const rect = {
      _class: "rectangle" as const,
      do_objectID: sketchId(),
      booleanOperation: FileFormat.BooleanOperation.None,
      isFixedToViewport: false,
      isFlippedHorizontal: false,
      isFlippedVertical: false,
      isLocked: false,
      isTemplate: false,
      isVisible: true,
      layerListExpandedType: FileFormat.LayerListExpanded.Undecided,
      name: "Screenshot",
      nameIsFixed: true,
      resizingConstraint: 63,
      resizingType: FileFormat.ResizeType.Stretch,
      rotation: 0,
      shouldBreakMaskChain: false,
      exportOptions: { ...DEFAULT_EXPORT_OPTIONS },
      frame: {
        _class: "rect" as const,
        constrainProportions: false,
        height: img.height,
        width: img.width,
        x: 0,
        y: 0,
      },
      clippingMaskMode: 0,
      hasClippingMask: false,
      style: fillStyle,
      edited: false,
      isClosed: true,
      pointRadiusBehaviour: FileFormat.PointsRadiusBehaviour.Rounded,
      points: cornerPoints(img.width, img.height),
      fixedRadius: 0,
      needsConvertionToNewRoundCorners: false,
      hasConvertedToNewRoundCorners: true,
    };

    const artboardId = sketchId();
    const name = images.length === 1 ? title : `Page ${i + 1}`;
    artboards.push({
      _class: "artboard",
      do_objectID: artboardId,
      booleanOperation: FileFormat.BooleanOperation.None,
      isFixedToViewport: false,
      isFlippedHorizontal: false,
      isFlippedVertical: false,
      isLocked: false,
      isTemplate: false,
      isVisible: true,
      layerListExpandedType: FileFormat.LayerListExpanded.Expanded,
      name,
      nameIsFixed: true,
      resizingConstraint: 63,
      resizingType: FileFormat.ResizeType.Stretch,
      rotation: 0,
      shouldBreakMaskChain: false,
      exportOptions: { ...DEFAULT_EXPORT_OPTIONS },
      frame: {
        _class: "rect",
        constrainProportions: false,
        height: img.height,
        width: img.width,
        x: cursorX,
        y: 0,
      },
      clippingMaskMode: 0,
      hasClippingMask: false,
      style: emptyStyle(1),
      hasClickThrough: true,
      groupLayout: { _class: "MSImmutableFreeformGroupLayout" },
      layers: [rect],
      horizontalRulerData: { ...DEFAULT_RULER },
      verticalRulerData: { ...DEFAULT_RULER },
      isFlowHome: false,
      resizesContent: false,
      backgroundColor: {
        _class: "color",
        red: 1,
        green: 1,
        blue: 1,
        alpha: 1,
      },
      hasBackgroundColor: false,
      includeBackgroundColorInExport: false,
      includeBackgroundColorInInstance: false,
    });
    artboardMeta[artboardId] = { name };
    cursorX += img.width + gap;
  }

  const page = {
    _class: "page" as const,
    do_objectID: pageId,
    booleanOperation: FileFormat.BooleanOperation.None,
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isTemplate: false,
    isVisible: true,
    layerListExpandedType: FileFormat.LayerListExpanded.Undecided,
    name: "Page 1",
    nameIsFixed: false,
    resizingConstraint: 63,
    resizingType: FileFormat.ResizeType.Stretch,
    rotation: 0,
    shouldBreakMaskChain: false,
    exportOptions: { ...DEFAULT_EXPORT_OPTIONS },
    frame: {
      _class: "rect" as const,
      constrainProportions: false,
      height: 0,
      width: 0,
      x: 0,
      y: 0,
    },
    clippingMaskMode: 0,
    hasClippingMask: false,
    style: emptyStyle(),
    hasClickThrough: true,
    groupLayout: { _class: "MSImmutableFreeformGroupLayout" as const },
    layers: artboards,
    horizontalRulerData: { ...DEFAULT_RULER },
    verticalRulerData: { ...DEFAULT_RULER },
  };

  const document = {
    _class: "document" as const,
    do_objectID: documentId,
    colorSpace: FileFormat.ColorSpace.Unmanaged,
    currentPageIndex: 0,
    assets: {
      _class: "assetCollection" as const,
      do_objectID: sketchId(),
      images: [] as unknown[],
      colorAssets: [] as unknown[],
      exportPresets: [] as unknown[],
      gradientAssets: [] as unknown[],
      colors: [] as unknown[],
      gradients: [] as unknown[],
    },
    foreignLayerStyles: [] as unknown[],
    foreignSymbols: [] as unknown[],
    foreignTextStyles: [] as unknown[],
    foreignSwatches: [] as unknown[],
    layerStyles: { _class: "sharedStyleContainer" as const, objects: [] },
    layerSymbols: { _class: "symbolContainer" as const, objects: [] },
    layerTextStyles: {
      _class: "sharedTextStyleContainer" as const,
      objects: [],
    },
    sharedSwatches: { _class: "swatchContainer" as const, objects: [] },
    perDocumentLibraries: [] as unknown[],
    pages: [
      {
        _class: "MSJSONFileReference" as const,
        _ref_class: "MSImmutablePage" as const,
        _ref: `pages/${pageId}`,
      },
    ],
  };

  const meta = {
    commit: "0000000000000000000000000000000000000000",
    pagesAndArtboards: {
      [pageId]: {
        name: "Page 1",
        artboards: artboardMeta,
      },
    },
    version: 134,
    fonts: [] as string[],
    compatibilityVersion: 99,
    app: FileFormat.BundleId.PublicRelease,
    autosaved: 0,
    variant: "NONAPPSTORE",
    created: {
      commit: "0000000000000000000000000000000000000000",
      appVersion: "99",
      build: 0,
      app: FileFormat.BundleId.PublicRelease,
      compatibilityVersion: 99,
      version: 134,
      variant: "NONAPPSTORE",
    },
    saveHistory: ["NONAPPSTORE.0"],
    appVersion: "99",
    build: 0,
  };

  const user = {
    document: {
      pageListHeight: 85,
      pageListCollapsed: 0,
    },
    [pageId]: {
      scrollOrigin: "{0, 0}",
      zoomValue: 1,
    },
  };

  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    [`pages/${pageId}.json`]: enc.encode(JSON.stringify(page)),
    "document.json": enc.encode(JSON.stringify(document)),
    "meta.json": enc.encode(JSON.stringify(meta)),
    "user.json": enc.encode(JSON.stringify(user)),
    "previews/preview.png":
      images[0] != null
        ? new Uint8Array(images[0].buffer)
        : createPlaceholderPng(),
  };
  for (const [sha1, bytes] of imagesMap) {
    files[`images/${sha1}`] = bytes;
  }

  return Buffer.from(zipSync(files, { level: 6 }));
}
