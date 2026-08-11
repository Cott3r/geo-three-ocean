export declare class GeoTiffDecoder {
    static decodeFloat32(arrayBuffer: ArrayBuffer): {
        floatArray: Float32Array;
        width: number;
        height: number;
    } | null;
    private static readTagValues;
    private static getSingleValue;
    private static getArrayValues;
    private static readPixelValue;
    private static decompress;
    private static decompressLZW;
    private static decompressDeflate;
    private static inflateRaw;
    private static decodeSymbol;
    private static buildHuffmanTree;
    private static fixedLitTable;
    private static fixedDistTable;
    private static buildFixedLitTable;
    private static buildFixedDistTable;
    private static applyHorizontalPredictor;
}
