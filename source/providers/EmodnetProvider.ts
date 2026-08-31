import { MapProvider } from './MapProvider';
import { UnitsUtils } from '../utils/UnitsUtils';
import { GeoTiffDecoder } from '../utils/GeoTiffDecoder';
import { XHRUtils } from '../utils/XHRUtils';

/**
 * Base EMODnet Bathymetry tile provider.
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
	 * Map image tile format or output format.
	 */
	public format: string;

	/**
	 * Coordinate reference system.
	 */
	public crs: string;

	/**
	 * WMS style name if using WMS GetMap fallback.
	 */
	public styles: string;

	public constructor(
		address: string = 'https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png',
		layers: string = 'emodnet:mean',
		format: string = 'image/png',
		styles: string = ''
	) {
		super();

		this.name = 'Emodnet';
		this.address = address;
		this.layers = layers;
		this.styles = styles;
		this.format = format;
		this.crs = 'EPSG:3857';
		this.minZoom = 0;
		this.maxZoom = 19;
	}

	public getTileUrl(zoom: number, x: number, y: number): string {
		if (this.address.includes('{z}') || this.address.includes('{x}') || this.address.includes('{y}')) {
			return this.address
				.replace('{z}', zoom.toString())
				.replace('{x}', x.toString())
				.replace('{y}', y.toString());
		}

		let url = this.address;
		if (!url.includes('?')) {
			url += '?';
		} else if (!url.endsWith('?') && !url.endsWith('&')) {
			url += '&';
		}

		const maxExtent = UnitsUtils.WEB_MERCATOR_MAX_EXTENT;
		const tileSize = (2 * maxExtent) / Math.pow(2, zoom);
		const minX = -maxExtent + x * tileSize;
		const maxX = minX + tileSize;
		const maxY = maxExtent - y * tileSize;
		const minY = maxY - tileSize;

		const params = new URLSearchParams({
			SERVICE: 'WMS',
			VERSION: '1.3.0',
			REQUEST: 'GetMap',
			LAYERS: this.layers,
			STYLES: this.styles || '',
			CRS: this.crs,
			WIDTH: '256',
			HEIGHT: '256',
			FORMAT: this.format,
			TRANSPARENT: 'TRUE',
			BBOX: `${minX},${minY},${maxX},${maxY}`
		});

		return url + params.toString();
	}

	public fetchTile(zoom: number, x: number, y: number): Promise<HTMLImageElement> {
		return XHRUtils.fetchImage(this.getTileUrl(zoom, x, y));
	}
}

/**
 * EMODnet Tile Provider for coloured map imagery.
 * Defaults to native tile endpoint: https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png
 */
export class EmodnetTileProvider extends EmodnetProvider {
	public constructor(
		address: string = 'https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png',
		layers: string = 'emodnet:mean',
		styles: string = '',
		format: string = 'image/png'
	) {
		super(address, layers, format, styles);
	}
}

/**
 * EMODnet WCS Provider for mathematical bathymetry depth elevation data.
 * Requests GeoTIFF coverages from WCS endpoint and converts depth data into Terrain-RGB canvas.
 */
export class EmodnetWCSProvider extends EmodnetProvider {
	/**
	 * Height amplification multiplier.
	 */
	public heightMultiplier: number;

	/**
	 * Controls whether client-side reprojection uses bilinear interpolation (true) or nearest-neighbor resampling (false).
	 */
	public useBilinear: boolean;

	/**
	 * EMODnet Bathymetry native DTM grid resolution in degrees (1/16 arc-minute = 1/960 degree).
	 */
	public static readonly DTM_RESOLUTION: number = 1.0 / 960.0;

	public constructor(
		address: string = 'https://ows.emodnet-bathymetry.eu/ows',
		coverage: string = 'emodnet:mean',
		heightMultiplier: number = 10.0,
		useBilinear: boolean = false
	) {
		super(address, coverage, 'GeoTIFF');
		this.heightMultiplier = heightMultiplier;
		this.useBilinear = useBilinear;
	}

	public getSnappedBbox(zoom: number, x: number, y: number): {
		sMinLon: number;
		sMaxLon: number;
		sMinLat: number;
		sMaxLat: number;
		width: number;
		height: number;
	} {
		const n = Math.pow(2, zoom);
		const minLon = (x / n) * 360.0 - 180.0;
		const maxLon = ((x + 1) / n) * 360.0 - 180.0;
		const maxLatRad = Math.atan(Math.sinh(Math.PI * (1.0 - (2.0 * y) / n)));
		const maxLat = 180.0 * (maxLatRad / Math.PI);
		const minLatRad = Math.atan(Math.sinh(Math.PI * (1.0 - (2.0 * (y + 1)) / n)));
		const minLat = 180.0 * (minLatRad / Math.PI);

		const dtmRes = EmodnetWCSProvider.DTM_RESOLUTION;
		// Snap outwards by 1 native DTM grid cell to guarantee full bilinear interpolation neighborhood on borders
		const sMinLon = Math.floor((minLon - dtmRes) / dtmRes) * dtmRes;
		const sMaxLon = Math.ceil((maxLon + dtmRes) / dtmRes) * dtmRes;
		const sMinLat = Math.floor((minLat - dtmRes) / dtmRes) * dtmRes;
		const sMaxLat = Math.ceil((maxLat + dtmRes) / dtmRes) * dtmRes;

		const width = Math.round((sMaxLon - sMinLon) / dtmRes);
		const height = Math.round((sMaxLat - sMinLat) / dtmRes);

		return { sMinLon, sMaxLon, sMinLat, sMaxLat, width, height };
	}

	public getTileUrl(zoom: number, x: number, y: number): string {
		let url = this.address;
		if (url.includes('{z}') || url.includes('{x}') || url.includes('{y}')) {
			url = 'https://ows.emodnet-bathymetry.eu/ows';
		}
		if (!url.includes('?')) {
			url += '?';
		} else if (!url.endsWith('?') && !url.endsWith('&')) {
			url += '&';
		}

		const sb = this.getSnappedBbox(zoom, x, y);

		const params = new URLSearchParams({
			SERVICE: 'WCS',
			VERSION: '1.0.0',
			REQUEST: 'GetCoverage',
			COVERAGE: this.layers,
			CRS: 'EPSG:4326',
			BBOX: `${sb.sMinLon},${sb.sMinLat},${sb.sMaxLon},${sb.sMaxLat}`,
			WIDTH: sb.width.toString(),
			HEIGHT: sb.height.toString(),
			FORMAT: 'GeoTIFF'
		});

		return url + params.toString();
	}

	/**
	 * Reprojects a Float32 depth array from native EPSG:4326 (geographic coordinates) to EPSG:3857 (Web Mercator).
	 * Performs client-side warping with bilinear interpolation or nearest neighbor resampling over snapped native DTM coverage.
	 */
	public reprojectEPSG4326To3857(
		srcArray: Float32Array,
		srcWidth: number,
		srcHeight: number,
		zoom: number,
		x: number,
		y: number
	): Float32Array {
		const dstWidth = 256;
		const dstHeight = 256;
		const dstArray = new Float32Array(dstWidth * dstHeight);

		const maxExtent = UnitsUtils.WEB_MERCATOR_MAX_EXTENT;
		const tileSize = (2 * maxExtent) / Math.pow(2, zoom);
		const minX = -maxExtent + x * tileSize;
		const maxX = minX + tileSize;
		const maxY = maxExtent - y * tileSize;
		const minY = maxY - tileSize;

		const sb = this.getSnappedBbox(zoom, x, y);

		const sLonSpan = sb.sMaxLon - sb.sMinLon;
		const sLatSpan = sb.sMaxLat - sb.sMinLat;

		for (let r = 0; r < dstHeight; r++) {
			// Corner-to-corner mesh node alignment: r=0 is maxY (top), r=255 is minY (bottom)
			const my = maxY - (r / (dstHeight - 1)) * (maxY - minY);
			const latRad = Math.atan(Math.sinh((my / maxExtent) * Math.PI));
			const lat = (latRad * 180.0) / Math.PI;

			const v = sLatSpan !== 0 ? ((sb.sMaxLat - lat) / sLatSpan) * srcHeight - 0.5 : 0;

			for (let c = 0; c < dstWidth; c++) {
				// Corner-to-corner mesh node alignment: c=0 is minX (left), c=255 is maxX (right)
				const mx = minX + (c / (dstWidth - 1)) * (maxX - minX);
				const lon = (mx / maxExtent) * 180.0;

				const u = sLonSpan !== 0 ? ((lon - sb.sMinLon) / sLonSpan) * srcWidth - 0.5 : 0;

				let sample: number;

				if (this.useBilinear) {
					const u0 = Math.floor(u);
					const u1 = u0 + 1;
					const v0 = Math.floor(v);
					const v1 = v0 + 1;

					const fu = u - u0;
					const fv = v - v0;

					const cu0 = Math.max(0, Math.min(srcWidth - 1, u0));
					const cu1 = Math.max(0, Math.min(srcWidth - 1, u1));
					const cv0 = Math.max(0, Math.min(srcHeight - 1, v0));
					const cv1 = Math.max(0, Math.min(srcHeight - 1, v1));

					const val00 = srcArray[cv0 * srcWidth + cu0];
					const val10 = srcArray[cv0 * srcWidth + cu1];
					const val01 = srcArray[cv1 * srcWidth + cu0];
					const val11 = srcArray[cv1 * srcWidth + cu1];

					const isValid = (val: number) => !isNaN(val) && val > -100000 && val < 100000;

					if (isValid(val00) && isValid(val10) && isValid(val01) && isValid(val11)) {
						sample = (1 - fu) * (1 - fv) * val00 + fu * (1 - fv) * val10 + (1 - fu) * fv * val01 + fu * fv * val11;
					} else {
						const nearestU = Math.max(0, Math.min(srcWidth - 1, Math.round(u)));
						const nearestV = Math.max(0, Math.min(srcHeight - 1, Math.round(v)));
						sample = srcArray[nearestV * srcWidth + nearestU];
					}
				} else {
					const nearestU = Math.max(0, Math.min(srcWidth - 1, Math.round(u)));
					const nearestV = Math.max(0, Math.min(srcHeight - 1, Math.round(v)));
					sample = srcArray[nearestV * srcWidth + nearestU];
				}

				dstArray[r * dstWidth + c] = sample;
			}
		}

		if (zoom === 19 && x === 283370 && y === 189772) {
			const expectedMin = -18.6171875;
			const expectedMax = -15.390625;
			const outOfBounds: { r: number; c: number; val: number }[] = [];

			let dstMin = Infinity;
			let dstMax = -Infinity;
			for (let r = 0; r < dstHeight; r++) {
				for (let c = 0; c < dstWidth; c++) {
					const val = dstArray[r * dstWidth + c];
					if (val < dstMin) dstMin = val;
					if (val > dstMax) dstMax = val;
					if (val < expectedMin || val > expectedMax) {
						outOfBounds.push({ r, c, val });
					}
				}
			}

			if (outOfBounds.length > 0) {
				let srcMin = Infinity;
				let srcMax = -Infinity;
				for (let i = 0; i < srcArray.length; i++) {
					const sv = srcArray[i];
					if (!isNaN(sv)) {
						if (sv < srcMin) srcMin = sv;
						if (sv > srcMax) srcMax = sv;
					}
				}

				console.warn(
					`[EmodnetWCSProvider Debug] Tile (z:${zoom}, x:${x}, y:${y}) returned unexpected height values outside expected range [${expectedMin}, ${expectedMax}]:`,
					{
						outOfBoundsCount: outOfBounds.length,
						dstMin,
						dstMax,
						srcMin,
						srcMax,
						sampleOutOfBounds: outOfBounds.slice(0, 10),
						snappedBbox: sb
					}
				);
			} else {
				console.log(
					`[EmodnetWCSProvider Debug] Tile (z:${zoom}, x:${x}, y:${y}) all depth values within expected range [${expectedMin}, ${expectedMax}]. (Min: ${dstMin}, Max: ${dstMax})`
				);
			}
		}

		return dstArray;
	}

	public async fetchTile(zoom: number, x: number, y: number): Promise<HTMLCanvasElement> {
		const tileUrl = this.getTileUrl(zoom, x, y);

		try {
			const arrayBuffer = await XHRUtils.getRaw(tileUrl);
			const parsed = this.parseGeoTIFFFloat32(arrayBuffer);
			if (!parsed) {
				throw new Error('Failed to parse GeoTIFF mathematical depth data');
			}

			const reprojected = this.reprojectEPSG4326To3857(parsed.floatArray, parsed.width, parsed.height, zoom, x, y);
			return this.encodeHeightToTerrainRGB(reprojected, 256, 256);
		} catch (err) {
			const canvas = document.createElement('canvas');
			canvas.width = 256;
			canvas.height = 256;
			return canvas;
		}
	}

	private parseGeoTIFFFloat32(arrayBuffer: ArrayBuffer): { floatArray: Float32Array; width: number; height: number } | null {
		return GeoTiffDecoder.decodeFloat32(arrayBuffer);
	}


	public encodeHeightToTerrainRGB(floatArray: Float32Array, width: number, height: number): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return canvas;
		}
		ctx.imageSmoothingEnabled = false;

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
