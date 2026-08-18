import { MapProvider } from './MapProvider';
export declare class EmodnetProvider extends MapProvider {
    address: string;
    layers: string;
    format: string;
    crs: string;
    styles: string;
    constructor(address?: string, layers?: string, format?: string, styles?: string);
    getTileUrl(zoom: number, x: number, y: number): string;
    fetchTile(zoom: number, x: number, y: number): Promise<HTMLImageElement>;
}
export declare class EmodnetTileProvider extends EmodnetProvider {
    constructor(address?: string, layers?: string, styles?: string, format?: string);
}
export declare class EmodnetWCSProvider extends EmodnetProvider {
    heightMultiplier: number;
    useBilinear: boolean;
    static readonly DTM_RESOLUTION: number;
    constructor(address?: string, coverage?: string, heightMultiplier?: number, useBilinear?: boolean);
    getSnappedBbox(zoom: number, x: number, y: number): {
        sMinLon: number;
        sMaxLon: number;
        sMinLat: number;
        sMaxLat: number;
        width: number;
        height: number;
    };
    getTileUrl(zoom: number, x: number, y: number): string;
    reprojectEPSG4326To3857(srcArray: Float32Array, srcWidth: number, srcHeight: number, zoom: number, x: number, y: number): Float32Array;
    fetchTile(zoom: number, x: number, y: number): Promise<HTMLCanvasElement>;
    private parseGeoTIFFFloat32;
    encodeHeightToTerrainRGB(floatArray: Float32Array, width: number, height: number): HTMLCanvasElement;
}
