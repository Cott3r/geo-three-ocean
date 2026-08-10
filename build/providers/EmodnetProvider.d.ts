import { MapProvider } from './MapProvider';
export declare class EmodnetProvider extends MapProvider {
    address: string;
    layers: string;
    styles: string;
    format: string;
    service: 'WMS' | 'WCS';
    heightMultiplier: number;
    crs: string;
    constructor(address?: string, layers?: string, styles?: string, format?: string, service?: 'WMS' | 'WCS', heightMultiplier?: number);
    fetchTile(zoom: number, x: number, y: number): Promise<any>;
    private fetchWMSTile;
    private fetchWCSTile;
    private parseGeoTIFFFloat32;
    private cleanAndFillNoData;
    private encodeHeightToTerrainRGB;
}
