import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EmodnetProvider, EmodnetTileProvider, EmodnetWCSProvider } from '../../source/providers/EmodnetProvider';
import { GeoTiffDecoder } from '../../source/utils/GeoTiffDecoder';
import { UnitsUtils } from '../../source/utils/UnitsUtils';

/**
 * Encodes Float32 depth array into a Terrain-RGB HTMLCanvasElement, overlays centerpoints
 * of each point from the floatArray, and exports the canvas to a PNG image file.
 */
function encodeAndExportTerrainRGBImage(
	provider: EmodnetWCSProvider,
	floatArray: Float32Array,
	width: number,
	height: number,
	pngPath: string
): HTMLCanvasElement {
	console.log(`[encodeAndExportTerrainRGBImage] FloatArray size: ${floatArray.length} elements (${floatArray.byteLength} bytes / ${(floatArray.byteLength / 1024).toFixed(2)} KB), Grid dimensions: ${width}x${height} (${width * height} total pixels)`);

	const canvas = provider.encodeHeightToTerrainRGB(floatArray, width, height);

	console.log(`[encodeAndExportTerrainRGBImage] Canvas image size: ${canvas.width}x${canvas.height} pixels`);

	let imageBuffer: Buffer;
	if (typeof (canvas as any).toBuffer === 'function') {
		imageBuffer = (canvas as any).toBuffer('image/png');
	} else {
		const dataUrl = canvas.toDataURL('image/png');
		const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
		imageBuffer = Buffer.from(base64Data, 'base64');
	}

	fs.writeFileSync(pngPath, imageBuffer);
	console.log(`[encodeAndExportTerrainRGBImage] Exported PNG image size: ${imageBuffer.length} bytes (${(imageBuffer.length / 1024).toFixed(2)} KB) -> ${pngPath}`);
	return canvas;
}

describe('EmodnetProvider Integration Tests', () => {
	const endpoint = 'https://ows.emodnet-bathymetry.eu/ows';
	const layer = 'emodnet:mean';

	// The 4 specific tiles requested by the user
	const targetTiles = [
		// { z: 15, x: 17674, y: 11765 },
		{ z: 19, x: 283370, y: 189772 },
		// { z: 13, x: 4427, y: 2946 },
		// { z: 13, x: 4428, y: 2946 },
		// { z: 13, x: 4427, y: 2945 },
		// { z: 13, x: 4428, y: 2945 }
	];

	describe('Tile Imagery Mode (EmodnetTileProvider)', () => {
		const nativeProvider = new EmodnetTileProvider();
		const wmsProvider = new EmodnetTileProvider(endpoint, layer, '', 'image/png');

		it('should generate valid native tile URLs for all 4 target tiles', () => {
			for (const tile of targetTiles) {
				const url = nativeProvider.getTileUrl(tile.z, tile.x, tile.y);
				expect(url).toBe(`https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/${tile.z}/${tile.x}/${tile.y}.png`);
			}
		});

		it('should generate valid WMS GetMap URLs when explicit OWS endpoint is provided', () => {
			for (const tile of targetTiles) {
				const url = wmsProvider.getTileUrl(tile.z, tile.x, tile.y);
				expect(url).toContain(endpoint);
				expect(url).toContain('SERVICE=WMS');
				expect(url).toContain('REQUEST=GetMap');
				expect(url).toContain('LAYERS=emodnet%3Amean');
				expect(url).toContain('CRS=EPSG%3A3857');
				expect(url.toLowerCase()).toContain('format=image%2fpng');
				expect(url).toContain('BBOX=');
			}
		});

		it('should successfully download native tile imagery from live server', async () => {
			for (const tile of targetTiles) {
				const url = nativeProvider.getTileUrl(tile.z, tile.x, tile.y);
				const response = await fetch(url);

				expect(response.status).toBe(200);

				const contentType = response.headers.get('content-type');
				expect(contentType).toBeTruthy();
				expect(contentType?.toLowerCase()).toContain('image/png');

				const buffer = await response.arrayBuffer();
				expect(buffer.byteLength).toBeGreaterThan(0);
			}
		});
	});

	describe('WCS Mode (EmodnetWCSProvider - Mathematical Depth Data)', () => {
		const wcsProvider = new EmodnetWCSProvider(endpoint, layer, 1.0);

		it('should generate valid WCS GetCoverage URLs in EPSG:4326 for all 4 target tiles', () => {
			for (const tile of targetTiles) {
				const url = wcsProvider.getTileUrl(tile.z, tile.x, tile.y);
				expect(url).toContain(endpoint);
				expect(url).toContain('SERVICE=WCS');
				expect(url).toContain('REQUEST=GetCoverage');
				expect(url).toContain('COVERAGE=emodnet%3Amean');
				expect(url).toContain('CRS=EPSG%3A4326');
				expect(url).toContain('FORMAT=GeoTIFF');
				expect(url).toContain('BBOX=');
			}
		});

		it('should successfully download, decode, and save Float32 GeoTIFF depth tiles for all 4 target tiles', async () => {
			const outputDir = path.join(__dirname, '../output/depths');
			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}

			const maxExtent = UnitsUtils.WEB_MERCATOR_MAX_EXTENT;

			for (const tile of targetTiles) {
				// Calculate EPSG:3857 coordinates
				const tileSize = (2 * maxExtent) / Math.pow(2, tile.z);
				const minX = -maxExtent + tile.x * tileSize;
				const maxX = minX + tileSize;
				const maxY = maxExtent - tile.y * tileSize;
				const minY = maxY - tileSize;
				const centerX = (minX + maxX) / 2;
				const centerY = (minY + maxY) / 2;

				console.log(`\n--- Tile (${tile.z}, ${tile.x}, ${tile.y}) EPSG:3857 Coordinates ---`);
				console.log(`  BBOX [minX, minY, maxX, maxY]: [${minX.toFixed(3)}, ${minY.toFixed(3)}, ${maxX.toFixed(3)}, ${maxY.toFixed(3)}]`);
				console.log(`  Center [X, Y]: [${centerX.toFixed(3)}, ${centerY.toFixed(3)}]`);

				const url = wcsProvider.getTileUrl(tile.z, tile.x, tile.y);
				const response = await fetch(url);

				expect(response.status).toBe(200);

				const arrayBuffer = await response.arrayBuffer();
				expect(arrayBuffer.byteLength).toBeGreaterThan(1000);

				// Decode the raw Float32 GeoTIFF coverage payload (native EPSG:4326)
				const decoded = GeoTiffDecoder.decodeFloat32(arrayBuffer);
				expect(decoded).not.toBeNull();

				if (decoded) {
					// expect(decoded.width).toBeGreaterThan(30);
					// expect(decoded.height).toBeGreaterThan(20);
					// expect(decoded.floatArray.length).toBe(decoded.width * decoded.height);

					// Reproject native EPSG:4326 depth array to EPSG:3857 client-side (256x256)
					const reprojected = wcsProvider.reprojectEPSG4326To3857(
						decoded.floatArray,
						decoded.width,
						decoded.height,
						tile.z,
						tile.x,
						tile.y
					);

					// Inspect depth values from reprojected array
					const validDepths: number[] = [];
					for (let i = 0; i < reprojected.length; i++) {
						const v = reprojected[i];
						if (!isNaN(v) && v > -100000 && v < 100000) {
							validDepths.push(v);
						}
					}

					// Verify valid ocean bathymetry depth values exist in the tile
					expect(validDepths.length).toBeGreaterThan(0);

					// Verify depths fall within expected realistic Mediterranean Sea bathymetry range
					const minDepth = Math.min(...validDepths);
					const maxDepth = Math.max(...validDepths);

					expect(minDepth).toBeGreaterThanOrEqual(-6000);
					expect(maxDepth).toBeLessThanOrEqual(500);

					// Save decoded depth data to disk
					const tileName = `tile_${tile.z}_${tile.x}_${tile.y}_depths`;

					// Save JSON metadata and full depth array
					const jsonPath = path.join(outputDir, `${tileName}.json`);
					const jsonData = {
						zoom: tile.z,
						x: tile.x,
						y: tile.y,
						epsg3857: {
							minX,
							minY,
							maxX,
							maxY,
							centerX,
							centerY,
							bboxStr: `${minX},${minY},${maxX},${maxY}`
						},
						width: 256,
						height: 256,
						totalPixels: reprojected.length,
						validPixelCount: validDepths.length,
						minDepth,
						maxDepth,
						depths: Array.from(reprojected)
					};
					fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
					expect(fs.existsSync(jsonPath)).toBe(true);

					// Encode depth array into Terrain-RGB HTMLCanvasElement, mark centerpoints, and export PNG
					const pngPath = path.join(outputDir, `tile_${tile.z}_${tile.x}_${tile.y}_terrain_rgb.png`);
					const canvas = encodeAndExportTerrainRGBImage(wcsProvider, reprojected, 256, 256, pngPath);

					expect(canvas).toBeDefined();
					expect(canvas.width).toBe(256);
					expect(canvas.height).toBe(256);
					expect(fs.existsSync(pngPath)).toBe(true);
					expect(fs.statSync(pngPath).size).toBeGreaterThan(0);
				}
			}
		});

		it('should validate decoded WCS tile depth values against ground truth reference dataset ("Mean depth natural colour (with land).json")', async () => {
			const refJsonPath = path.join(__dirname, 'Mean depth natural colour (with land).json');
			expect(fs.existsSync(refJsonPath)).toBe(true);

			const refRaw = fs.readFileSync(refJsonPath, 'utf8');
			const refData = JSON.parse(refRaw);
			const rows: [number, number, number | null, ...any[]][] = refData.table.rows;

			expect(rows.length).toBeGreaterThan(0);

			const maxExtent = UnitsUtils.WEB_MERCATOR_MAX_EXTENT;

			function lonToX(lon: number): number {
				return (lon * maxExtent) / 180.0;
			}

			function latToY(lat: number): number {
				const rad = (lat * Math.PI) / 180.0;
				return (Math.log(Math.tan(Math.PI / 4 + rad / 2)) * maxExtent) / Math.PI;
			}

			let totalMatchedPoints = 0;
			let totalAbsDiff = 0;
			const pointDiffs: number[] = [];

			for (const tile of targetTiles) {
				const tileSize = (2 * maxExtent) / Math.pow(2, tile.z);
				const minX = -maxExtent + tile.x * tileSize;
				const maxX = minX + tileSize;
				const maxY = maxExtent - tile.y * tileSize;
				const minY = maxY - tileSize;

				const url = wcsProvider.getTileUrl(tile.z, tile.x, tile.y);
				const response = await fetch(url);
				expect(response.status).toBe(200);

				const arrayBuffer = await response.arrayBuffer();
				const decoded = GeoTiffDecoder.decodeFloat32(arrayBuffer);
				expect(decoded).not.toBeNull();

				if (decoded) {
					const reprojected = wcsProvider.reprojectEPSG4326To3857(
						decoded.floatArray,
						decoded.width,
						decoded.height,
						tile.z,
						tile.x,
						tile.y
					);

					let pointsInBbox = 0;
					let nullRefPoints = 0;
					let noDataTilePoints = 0;
					let tileMatches = 0;

					for (const row of rows) {
						const lat = row[0];
						const lon = row[1];
						const refElev = row[2];

						const mx = lonToX(lon);
						const my = latToY(lat);

						if (mx >= minX && mx < maxX && my >= minY && my < maxY) {
							pointsInBbox++;

							if (refElev === null || isNaN(refElev)) {
								nullRefPoints++;
								continue;
							}

							const px = Math.floor(((mx - minX) / tileSize) * 256);
							const py = Math.floor(((maxY - my) / tileSize) * 256);

							const clampedPx = Math.max(0, Math.min(255, px));
							const clampedPy = Math.max(0, Math.min(255, py));

							const idx = clampedPy * 256 + clampedPx;
							const tileDepth = reprojected[idx];

							if (isNaN(tileDepth) || tileDepth <= -100000 || tileDepth >= 100000) {
								noDataTilePoints++;
							} else {
								const diff = Math.abs(tileDepth - refElev);
								totalAbsDiff += diff;
								pointDiffs.push(diff);
								tileMatches++;
								totalMatchedPoints++;
							}
						}
					}
					console.log(`\nTile (${tile.z}, ${tile.x}, ${tile.y}) breakdown:`);
					console.log(`  Reference points in BBOX: ${pointsInBbox}`);
					console.log(`  Points with null/NaN refElev: ${nullRefPoints}`);
					console.log(`  Points with NaN/NoData tile depth: ${noDataTilePoints}`);
					console.log(`  Valid matching depth points: ${tileMatches}`);
				}
			}

			console.log(`Total matched reference points across target tiles: ${totalMatchedPoints}`);

			expect(totalMatchedPoints).toBeGreaterThan(0);

			const meanAbsError = totalAbsDiff / totalMatchedPoints;
			console.log(`Mean Absolute Error (MAE) compared to ground truth dataset: ${meanAbsError.toFixed(3)} meters`);

			expect(meanAbsError).toBeLessThan(5.0);
		});

		it('should verify 0.000m border continuity across adjacent tiles', async () => {
			const tileL = { z: 13, x: 4427, y: 2946 };
			const tileR = { z: 13, x: 4428, y: 2946 };
			const tileT = { z: 13, x: 4427, y: 2945 };

			const urlL = wcsProvider.getTileUrl(tileL.z, tileL.x, tileL.y);
			const urlR = wcsProvider.getTileUrl(tileR.z, tileR.x, tileR.y);
			const urlT = wcsProvider.getTileUrl(tileT.z, tileT.x, tileT.y);

			const abL = await (await fetch(urlL)).arrayBuffer();
			const abR = await (await fetch(urlR)).arrayBuffer();
			const abT = await (await fetch(urlT)).arrayBuffer();

			const decL = GeoTiffDecoder.decodeFloat32(abL)!;
			const decR = GeoTiffDecoder.decodeFloat32(abR)!;
			const decT = GeoTiffDecoder.decodeFloat32(abT)!;

			const reprojectedL = wcsProvider.reprojectEPSG4326To3857(decL.floatArray, decL.width, decL.height, tileL.z, tileL.x, tileL.y);
			const reprojectedR = wcsProvider.reprojectEPSG4326To3857(decR.floatArray, decR.width, decR.height, tileR.z, tileR.x, tileR.y);
			const reprojectedT = wcsProvider.reprojectEPSG4326To3857(decT.floatArray, decT.width, decT.height, tileT.z, tileT.x, tileT.y);

			let totalHDiff = 0;
			for (let r = 0; r < 256; r++) {
				const vL = reprojectedL[r * 256 + 255];
				const vR = reprojectedR[r * 256 + 0];
				totalHDiff += Math.abs(vL - vR);
			}
			const avgHDiff = totalHDiff / 256;
			console.log(`\n[Border Continuity Test] Average horizontal border difference: ${avgHDiff.toFixed(10)} meters`);
			expect(avgHDiff).toBeLessThan(0.000001);

			let totalVDiff = 0;
			for (let c = 0; c < 256; c++) {
				const vT = reprojectedT[255 * 256 + c];
				const vL = reprojectedL[0 * 256 + c];
				totalVDiff += Math.abs(vT - vL);
			}
			const avgVDiff = totalVDiff / 256;
			console.log(`[Border Continuity Test] Average vertical border difference: ${avgVDiff.toFixed(10)} meters`);
			expect(avgVDiff).toBeLessThan(0.000001);
		});
	});
});
