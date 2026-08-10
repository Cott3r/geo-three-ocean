import { MapProvider } from './MapProvider';
import { UnitsUtils } from '../utils/UnitsUtils';

/**
 * EMODnet Bathymetry tile provider.
 *
 * Supports both WMS (for coloured map imagery) and WCS (for mathematical depth elevation).
 */
export class EmodnetProvider extends MapProvider {
	/**
	 * Service address endpoint.
	 */
	public address: string;

	/**
	 * WMS/WCS layer or coverage name.
	 */
	public layers: string;

	/**
	 * WMS style name.
	 */
	public styles: string;

	/**
	 * Map image tile format for WMS.
	 */
	public format: string;

	/**
	 * Service type ('WMS' for map imagery, 'WCS' for raw mathematical depth).
	 */
	public service: 'WMS' | 'WCS';

	/**
	 * Height amplification multiplier.
	 */
	public heightMultiplier: number;

	/**
	 * Coordinate reference system.
	 */
	public crs: string;

	public constructor(
		address: string = 'https://ows.emodnet-bathymetry.eu/ows',
		layers: string = 'emodnet:mean',
		styles: string = '',
		format: string = 'image/png',
		service: 'WMS' | 'WCS' = 'WMS',
		heightMultiplier: number = 10.0
	) {
		super();

		this.name = 'Emodnet';
		this.address = address;
		this.layers = layers;
		this.styles = styles;
		this.format = format;
		this.service = service;
		this.heightMultiplier = heightMultiplier;
		this.crs = 'EPSG:3857';
		this.minZoom = 0;
		this.maxZoom = 19;
	}

	public fetchTile(zoom: number, x: number, y: number): Promise<any> {
		if (this.service === 'WCS') {
			return this.fetchWCSTile(zoom, x, y);
		}
		return this.fetchWMSTile(zoom, x, y);
	}

	/**
	 * Fetch WMS image tile (coloured imagery).
	 */
	private fetchWMSTile(zoom: number, x: number, y: number): Promise<HTMLImageElement> {
		return new Promise<HTMLImageElement>((resolve, reject) => {
			const maxExtent = UnitsUtils.WEB_MERCATOR_MAX_EXTENT;
			const tileSize = (2 * maxExtent) / Math.pow(2, zoom);
			const minX = -maxExtent + x * tileSize;
			const maxX = minX + tileSize;
			const maxY = maxExtent - y * tileSize;
			const minY = maxY - tileSize;

			const image = document.createElement('img');
			image.onload = function () {
				resolve(image);
			};
			image.onerror = function () {
				reject();
			};
			image.crossOrigin = 'Anonymous';

			let url = this.address;
			if (!url.includes('?')) {
				url += '?';
			} else if (!url.endsWith('?') && !url.endsWith('&')) {
				url += '&';
			}

			const params = new URLSearchParams({
				SERVICE: 'WMS',
				VERSION: '1.3.0',
				REQUEST: 'GetMap',
				LAYERS: this.layers,
				STYLES: this.styles,
				CRS: this.crs,
				WIDTH: '256',
				HEIGHT: '256',
				FORMAT: this.format,
				TRANSPARENT: 'TRUE',
				BBOX: `${minX},${minY},${maxX},${maxY}`
			});

			image.src = url + params.toString();
		});
	}

	/**
	 * Fetch WCS coverage tile (mathematical depth data converted to Terrain-RGB canvas).
	 */
	private async fetchWCSTile(zoom: number, x: number, y: number): Promise<HTMLCanvasElement> {
		let url = this.address;
		if (!url.includes('?')) {
			url += '?';
		} else if (!url.endsWith('?') && !url.endsWith('&')) {
			url += '&';
		}

		let params: URLSearchParams;

		// For zoom >= 7, EPSG:3857 is supported natively by WCS and aligns directly with Web Mercator quadtree tiles.
		// For low zoom levels (< 7), fallback to EPSG:4326 to avoid WCS bandwidth limit errors.
		if (zoom >= 7) {
			const maxExtent = UnitsUtils.WEB_MERCATOR_MAX_EXTENT;
			const tileSize = (2 * maxExtent) / Math.pow(2, zoom);
			const minX = -maxExtent + x * tileSize;
			const maxX = minX + tileSize;
			const maxY = maxExtent - y * tileSize;
			const minY = maxY - tileSize;

			params = new URLSearchParams({
				SERVICE: 'WCS',
				VERSION: '1.0.0',
				REQUEST: 'GetCoverage',
				COVERAGE: this.layers,
				CRS: 'EPSG:3857',
				BBOX: `${minX},${minY},${maxX},${maxY}`,
				WIDTH: '256',
				HEIGHT: '256',
				FORMAT: 'GeoTIFF'
			});
		} else {
			const n = Math.pow(2, zoom);
			const minLon = (x / n) * 360.0 - 180.0;
			const maxLon = ((x + 1) / n) * 360.0 - 180.0;
			const maxLatRad = Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * y / n)));
			const maxLat = 180.0 * (maxLatRad / Math.PI);
			const minLatRad = Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * (y + 1) / n)));
			const minLat = 180.0 * (minLatRad / Math.PI);

			params = new URLSearchParams({
				SERVICE: 'WCS',
				VERSION: '1.0.0',
				REQUEST: 'GetCoverage',
				COVERAGE: this.layers,
				CRS: 'EPSG:4326',
				BBOX: `${minLon},${minLat},${maxLon},${maxLat}`,
				WIDTH: '256',
				HEIGHT: '256',
				FORMAT: 'GeoTIFF'
			});
		}

		try {
			const response = await fetch(url + params.toString());
			if (!response.ok) {
				throw new Error(`WCS fetch failed with status ${response.status}`);
			}

			const arrayBuffer = await response.arrayBuffer();
			const parsed = this.parseGeoTIFFFloat32(arrayBuffer);
			if (!parsed) {
				throw new Error('Failed to parse GeoTIFF mathematical depth data');
			}

			const cleanedArray = this.cleanAndFillNoData(parsed.floatArray, parsed.width, parsed.height);
			return this.encodeHeightToTerrainRGB(cleanedArray, parsed.width, parsed.height);
		} catch (err) {
			// Fallback: Return empty flat canvas if outside domain / fetch error
			const canvas = document.createElement('canvas');
			canvas.width = 256;
			canvas.height = 256;
			return canvas;
		}
	}

	/**
	 * Parse Float32 values from uncompressed/tiled GeoTIFF ArrayBuffer.
	 */
	private parseGeoTIFFFloat32(arrayBuffer: ArrayBuffer): { floatArray: Float32Array; width: number; height: number } | null {
		if (arrayBuffer.byteLength < 8) {
			return null;
		}

		const dataView = new DataView(arrayBuffer);
		const magic = dataView.getUint16(0, false);
		const isBigEndian = magic === 0x4d4d;
		const isLittleEndian = magic === 0x4949;
		if (!isBigEndian && !isLittleEndian) {
			return null;
		}

		const littleEndian = isLittleEndian;
		const ifdOffset = dataView.getUint32(4, littleEndian);
		if (ifdOffset + 2 > arrayBuffer.byteLength) {
			return null;
		}

		const numEntries = dataView.getUint16(ifdOffset, littleEndian);
		let dataOffset = 0;
		let tileWidth = 256;
		let tileHeight = 256;

		for (let i = 0; i < numEntries; i++) {
			const entryOffset = ifdOffset + 2 + i * 12;
			if (entryOffset + 12 > arrayBuffer.byteLength) {
				break;
			}

			const tag = dataView.getUint16(entryOffset, littleEndian);
			const type = dataView.getUint16(entryOffset + 2, littleEndian);
			const count = dataView.getUint32(entryOffset + 4, littleEndian);
			const rawVal = dataView.getUint32(entryOffset + 8, littleEndian);

			if (tag === 256) {
				tileWidth = type === 3 ? (isBigEndian ? (rawVal >>> 16) : (rawVal & 0xffff)) : rawVal;
			}
			if (tag === 257) {
				tileHeight = type === 3 ? (isBigEndian ? (rawVal >>> 16) : (rawVal & 0xffff)) : rawVal;
			}
			if (tag === 273 || tag === 324) {
				dataOffset = (count === 1) ? rawVal : dataView.getUint32(rawVal, littleEndian);
			}
		}

		if (!dataOffset || dataOffset >= arrayBuffer.byteLength) {
			dataOffset = 384;
		}

		const totalPixels = tileWidth * tileHeight;
		const floatArray = new Float32Array(totalPixels);
		let ptr = dataOffset;

		for (let i = 0; i < totalPixels; i++) {
			if (ptr + 4 <= arrayBuffer.byteLength) {
				floatArray[i] = dataView.getFloat32(ptr, littleEndian);
				ptr += 4;
			} else {
				floatArray[i] = 0;
			}
		}

		return { floatArray, width: tileWidth, height: tileHeight };
	}

	/**
	 * Clean and propagate valid depth values to fill NoData/NaN edge pixels.
	 */
	private cleanAndFillNoData(floatArray: Float32Array, width: number, height: number): Float32Array {
		const cleaned = new Float32Array(floatArray.length);
		let lastValid = 0;

		// First pass: find global first valid depth value
		for (let i = 0; i < floatArray.length; i++) {
			const v = floatArray[i];
			if (!isNaN(v) && v > -100000 && v < 100000) {
				lastValid = v;
				break;
			}
		}

		// Row-by-row propagation to prevent edge cliff spikes
		for (let r = 0; r < height; r++) {
			let rowValid = lastValid;
			for (let c = 0; c < width; c++) {
				const v = floatArray[r * width + c];
				if (!isNaN(v) && v > -100000 && v < 100000) {
					rowValid = v;
					break;
				}
			}

			let current = rowValid;
			for (let c = 0; c < width; c++) {
				const idx = r * width + c;
				const v = floatArray[idx];
				if (!isNaN(v) && v > -100000 && v < 100000) {
					current = v;
				}
				cleaned[idx] = current;
			}
			lastValid = current;
		}

		return cleaned;
	}

	/**
	 * Encode Float32 mathematical depth values into Terrain-RGB canvas pixel buffer.
	 * Amplifies height by heightMultiplier.
	 * Decoded by geo-three MapHeightNode as: height = (r*65536 + g*256 + b)*0.1 - 10000
	 */
	private encodeHeightToTerrainRGB(floatArray: Float32Array, width: number, height: number): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return canvas;
		}

		const imageData = ctx.createImageData(width, height);
		const data = imageData.data;

		for (let i = 0; i < floatArray.length; i++) {
			const rawDepth = floatArray[i];
			const depthMeters = rawDepth * this.heightMultiplier;
			let val = Math.round((depthMeters + 10000) * 10);
			val = Math.max(0, Math.min(16777215, val));

			const r = Math.floor(val / 65536) & 0xff;
			const g = Math.floor(val / 256) & 0xff;
			const b = val & 0xff;

			const pxIdx = i * 4;
			data[pxIdx] = r;
			data[pxIdx + 1] = g;
			data[pxIdx + 2] = b;
			data[pxIdx + 3] = 255;
		}

		ctx.putImageData(imageData, 0, 0);
		return canvas;
	}
}
