/**
 * Lightweight pure TypeScript GeoTIFF decoder.
 * Supports:
 * - Little Endian (II) & Big Endian (MM) TIFF files
 * - Multi-strip & Tiled layouts
 * - Uncompressed (1), LZW (5), and Deflate/ZLIB (8 / 32946)
 * - Predictor horizontal differencing (Predictor 2 & 3)
 * - Float32, Float64, Int16, UInt16, Int8, UInt8 sample formats
 */
export class GeoTiffDecoder {
	public static decodeFloat32(arrayBuffer: ArrayBuffer): { floatArray: Float32Array; width: number; height: number } | null {
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
		const version = dataView.getUint16(2, littleEndian);
		if (version !== 42) {
			return null; // Standard TIFF expected
		}

		const ifdOffset = dataView.getUint32(4, littleEndian);
		if (ifdOffset + 2 > arrayBuffer.byteLength) {
			return null;
		}

		const numEntries = dataView.getUint16(ifdOffset, littleEndian);
		const tags: Record<number, any> = {};

		for (let i = 0; i < numEntries; i++) {
			const entryOffset = ifdOffset + 2 + i * 12;
			if (entryOffset + 12 > arrayBuffer.byteLength) {
				break;
			}

			const tag = dataView.getUint16(entryOffset, littleEndian);
			const type = dataView.getUint16(entryOffset + 2, littleEndian);
			const count = dataView.getUint32(entryOffset + 4, littleEndian);

			tags[tag] = GeoTiffDecoder.readTagValues(dataView, entryOffset + 8, type, count, littleEndian, arrayBuffer.byteLength);
		}

		const width = GeoTiffDecoder.getSingleValue(tags[256], 0); // ImageWidth
		const height = GeoTiffDecoder.getSingleValue(tags[257], 0); // ImageLength
		if (width <= 0 || height <= 0) return null;

		const compression = GeoTiffDecoder.getSingleValue(tags[259], 1); // Compression (1=raw, 5=lzw, 8/32946=deflate)
		const predictor = GeoTiffDecoder.getSingleValue(tags[317], 1); // Predictor (1=none, 2=horizontal, 3=floating point)
		const sampleFormat = GeoTiffDecoder.getSingleValue(tags[339], 1); // SampleFormat (1=uint, 2=int, 3=float)
		const bitsPerSample = GeoTiffDecoder.getSingleValue(tags[258], 32); // BitsPerSample

		const stripOffsets = GeoTiffDecoder.getArrayValues(tags[273]);
		const stripByteCounts = GeoTiffDecoder.getArrayValues(tags[279]);
		const rowsPerStrip = GeoTiffDecoder.getSingleValue(tags[278], height);

		const tileWidth = GeoTiffDecoder.getSingleValue(tags[322], 0);
		const tileLength = GeoTiffDecoder.getSingleValue(tags[323], 0);
		const tileOffsets = GeoTiffDecoder.getArrayValues(tags[324]);
		const tileByteCounts = GeoTiffDecoder.getArrayValues(tags[325]);

		const totalPixels = width * height;
		const output = new Float32Array(totalPixels);
		const bytesPerPixel = Math.max(1, Math.floor(bitsPerSample / 8));

		if (tileOffsets.length > 0 && tileWidth > 0 && tileLength > 0) {
			// Tiled TIFF
			const tilesAcross = Math.ceil(width / tileWidth);
			const tilesDown = Math.ceil(height / tileLength);

			for (let ty = 0; ty < tilesDown; ty++) {
				for (let tx = 0; tx < tilesAcross; tx++) {
					const tileIdx = ty * tilesAcross + tx;
					if (tileIdx >= tileOffsets.length) break;

					const offset = tileOffsets[tileIdx];
					const byteCount = tileByteCounts[tileIdx] || 0;
					if (offset <= 0 || offset + byteCount > arrayBuffer.byteLength) continue;

					const compressedBytes = new Uint8Array(arrayBuffer, offset, byteCount);
					const rawTile = GeoTiffDecoder.decompress(compressedBytes, compression, tileWidth * tileLength * bytesPerPixel);
					if (!rawTile) continue;

					if (predictor > 1) {
						GeoTiffDecoder.applyPredictor(rawTile, tileWidth, tileLength, bytesPerPixel, sampleFormat, predictor, littleEndian);
					}

					const tileDataView = new DataView(rawTile.buffer, rawTile.byteOffset, rawTile.byteLength);
					const startY = ty * tileLength;
					const startX = tx * tileWidth;

					for (let tr = 0; tr < tileLength; tr++) {
						const r = startY + tr;
						if (r >= height) break;
						for (let tc = 0; tc < tileWidth; tc++) {
							const c = startX + tc;
							if (c >= width) break;

							const srcPixelIdx = tr * tileWidth + tc;
							const srcByteOffset = srcPixelIdx * bytesPerPixel;
							if (srcByteOffset + bytesPerPixel <= rawTile.byteLength) {
								output[r * width + c] = GeoTiffDecoder.readPixelValue(tileDataView, srcByteOffset, sampleFormat, bitsPerSample, littleEndian);
							}
						}
					}
				}
			}
		} else if (stripOffsets.length > 0) {
			// Striped TIFF
			for (let s = 0; s < stripOffsets.length; s++) {
				const offset = stripOffsets[s];
				const byteCount = stripByteCounts[s] || (arrayBuffer.byteLength - offset);
				if (offset <= 0 || offset > arrayBuffer.byteLength) continue;

				const validByteCount = Math.min(byteCount, arrayBuffer.byteLength - offset);
				const compressedBytes = new Uint8Array(arrayBuffer, offset, validByteCount);

				const startRow = s * rowsPerStrip;
				const currentStripRows = Math.min(rowsPerStrip, height - startRow);
				if (currentStripRows <= 0) break;

				const expectedBytes = width * currentStripRows * bytesPerPixel;
				const rawStrip = GeoTiffDecoder.decompress(compressedBytes, compression, expectedBytes);
				if (!rawStrip) continue;

				if (predictor > 1) {
					GeoTiffDecoder.applyPredictor(rawStrip, width, currentStripRows, bytesPerPixel, sampleFormat, predictor, littleEndian);
				}

				const stripDataView = new DataView(rawStrip.buffer, rawStrip.byteOffset, rawStrip.byteLength);
				const totalStripPixels = width * currentStripRows;

				for (let p = 0; p < totalStripPixels; p++) {
					const byteOff = p * bytesPerPixel;
					if (byteOff + bytesPerPixel > rawStrip.byteLength) break;

					const r = startRow + Math.floor(p / width);
					const c = p % width;
					if (r >= height) break;

					output[r * width + c] = GeoTiffDecoder.readPixelValue(stripDataView, byteOff, sampleFormat, bitsPerSample, littleEndian);
				}
			}
		}

		return { floatArray: output, width, height };
	}

	private static readTagValues(dataView: DataView, offsetOrValuePtr: number, type: number, count: number, littleEndian: boolean, totalLength: number): any {
		const typeSizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
		const size = typeSizes[type] || 1;
		const totalBytes = size * count;

		let valueOffset = offsetOrValuePtr;
		if (totalBytes > 4) {
			valueOffset = dataView.getUint32(offsetOrValuePtr, littleEndian);
			if (valueOffset + totalBytes > totalLength) {
				return null;
			}
		}

		const results: number[] = [];
		for (let i = 0; i < count; i++) {
			const ptr = valueOffset + i * size;
			if (ptr + size > totalLength) break;

			if (type === 1 || type === 7) results.push(dataView.getUint8(ptr));
			else if (type === 3) results.push(dataView.getUint16(ptr, littleEndian));
			else if (type === 4) results.push(dataView.getUint32(ptr, littleEndian));
			else if (type === 8) results.push(dataView.getInt16(ptr, littleEndian));
			else if (type === 9) results.push(dataView.getInt32(ptr, littleEndian));
			else if (type === 11) results.push(dataView.getFloat32(ptr, littleEndian));
			else if (type === 12) results.push(dataView.getFloat64(ptr, littleEndian));
			else results.push(dataView.getUint32(ptr, littleEndian));
		}

		return count === 1 ? results[0] : results;
	}

	private static getSingleValue(val: any, fallback: number): number {
		if (typeof val === 'number') return val;
		if (Array.isArray(val) && val.length > 0) return val[0];
		return fallback;
	}

	private static getArrayValues(val: any): number[] {
		if (Array.isArray(val)) return val;
		if (typeof val === 'number') return [val];
		return [];
	}

	private static readPixelValue(dataView: DataView, offset: number, sampleFormat: number, bitsPerSample: number, littleEndian: boolean): number {
		if (sampleFormat === 3) {
			if (bitsPerSample === 64) return dataView.getFloat64(offset, littleEndian);
			return dataView.getFloat32(offset, littleEndian);
		} else if (sampleFormat === 2) {
			if (bitsPerSample === 16) return dataView.getInt16(offset, littleEndian);
			if (bitsPerSample === 8) return dataView.getInt8(offset);
			return dataView.getInt32(offset, littleEndian);
		} else {
			if (bitsPerSample === 16) return dataView.getUint16(offset, littleEndian);
			if (bitsPerSample === 8) return dataView.getUint8(offset);
			return dataView.getUint32(offset, littleEndian);
		}
	}

	private static decompress(compressedBytes: Uint8Array, compression: number, expectedSize: number): Uint8Array | null {
		if (compression === 1) {
			return compressedBytes;
		} else if (compression === 5) {
			return GeoTiffDecoder.decompressLZW(compressedBytes, expectedSize);
		} else if (compression === 8 || compression === 32946) {
			return GeoTiffDecoder.decompressDeflate(compressedBytes, expectedSize);
		}
		return compressedBytes;
	}

	/**
	 * TIFF LZW Decompressor (9..12-bit MSB codes, ClearCode=256, EOI=257)
	 */
	private static decompressLZW(compressed: Uint8Array, expectedSize: number): Uint8Array {
		const out = new Uint8Array(expectedSize > 0 ? expectedSize : compressed.length * 4);
		let outIdx = 0;

		let dictionary: number[][] = [];
		const initDict = () => {
			dictionary = new Array(4096);
			for (let i = 0; i < 256; i++) {
				dictionary[i] = [i];
			}
			dictionary[256] = []; // Clear
			dictionary[257] = []; // EOI
		};

		initDict();
		let codeSize = 9;
		let nextCode = 258;

		let bitBuf = 0;
		let bitCount = 0;
		let bytePtr = 0;

		const readCode = (): number => {
			while (bitCount < codeSize) {
				if (bytePtr >= compressed.length) return 257;
				bitBuf = (bitBuf << 8) | (compressed[bytePtr++] & 0xff);
				bitCount += 8;
			}
			const code = (bitBuf >> (bitCount - codeSize)) & ((1 << codeSize) - 1);
			bitCount -= codeSize;
			return code;
		};

		let oldCode = -1;

		while (bytePtr <= compressed.length) {
			const code = readCode();
			if (code === 257) break; // End of Information

			if (code === 256) {
				initDict();
				codeSize = 9;
				nextCode = 258;
				oldCode = -1;
				continue;
			}

			let entry: number[];
			if (code < nextCode) {
				entry = dictionary[code];
			} else if (code === nextCode) {
				if (oldCode === -1) break;
				const prevEntry = dictionary[oldCode];
				entry = prevEntry.concat(prevEntry[0]);
			} else {
				break; // Corrupted stream
			}

			if (entry) {
				for (let i = 0; i < entry.length; i++) {
					if (outIdx < out.length) {
						out[outIdx++] = entry[i];
					}
				}

				if (oldCode !== -1 && nextCode < 4096) {
					const prevEntry = dictionary[oldCode];
					dictionary[nextCode++] = prevEntry.concat(entry[0]);
					if (nextCode >= (1 << codeSize) - 1 && codeSize < 12) {
						codeSize++;
					}
				}
				oldCode = code;
			}
		}

		return out.subarray(0, outIdx);
	}

	private static decompressDeflate(compressed: Uint8Array, expectedSize: number): Uint8Array {
		let input = compressed;
		if (compressed.length > 2 && (compressed[0] & 0x0f) === 8) {
			const check = (compressed[0] << 8) | compressed[1];
			if (check % 31 === 0) {
				input = compressed.subarray(2);
			}
		}

		try {
			return GeoTiffDecoder.inflateRaw(input, expectedSize);
		} catch (e) {
			return compressed;
		}
	}

	private static inflateRaw(compressed: Uint8Array, expectedSize: number): Uint8Array {
		const out = new Uint8Array(expectedSize > 0 ? expectedSize : compressed.length * 6);
		let outIdx = 0;
		let bitBuf = 0;
		let bitCount = 0;
		let bytePtr = 0;

		const readBits = (n: number): number => {
			while (bitCount < n) {
				if (bytePtr >= compressed.length) return 0;
				bitBuf |= (compressed[bytePtr++] & 0xff) << bitCount;
				bitCount += 8;
			}
			const res = bitBuf & ((1 << n) - 1);
			bitBuf >>= n;
			bitCount -= n;
			return res;
		};

		let isFinal = 0;
		do {
			isFinal = readBits(1);
			const blockType = readBits(2);

			if (blockType === 0) {
				bitBuf = 0;
				bitCount = 0;
				if (bytePtr + 4 > compressed.length) break;
				const len = compressed[bytePtr] | (compressed[bytePtr + 1] << 8);
				bytePtr += 4;
				for (let i = 0; i < len && bytePtr < compressed.length; i++) {
					out[outIdx++] = compressed[bytePtr++];
				}
			} else if (blockType === 1 || blockType === 2) {
				let litTable: number[], distTable: number[];

				if (blockType === 1) {
					litTable = GeoTiffDecoder.buildFixedLitTable();
					distTable = GeoTiffDecoder.buildFixedDistTable();
				} else {
					const hlit = readBits(5) + 257;
					const hdist = readBits(5) + 1;
					const hclen = readBits(4) + 4;
					const codeOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
					const codeLengths = new Uint8Array(19);

					for (let i = 0; i < hclen; i++) {
						codeLengths[codeOrder[i]] = readBits(3);
					}

					const codeTree = GeoTiffDecoder.buildHuffmanTree(codeLengths);
					const combinedLengths = new Uint8Array(hlit + hdist);
					let idx = 0;

					while (idx < hlit + hdist) {
						const sym = GeoTiffDecoder.decodeSymbol(readBits, codeTree);
						if (sym < 16) {
							combinedLengths[idx++] = sym;
						} else if (sym === 16) {
							const prev = idx > 0 ? combinedLengths[idx - 1] : 0;
							const repeat = Math.min(readBits(2) + 3, hlit + hdist - idx);
							for (let r = 0; r < repeat; r++) combinedLengths[idx++] = prev;
						} else if (sym === 17) {
							const repeat = Math.min(readBits(3) + 3, hlit + hdist - idx);
							for (let r = 0; r < repeat; r++) combinedLengths[idx++] = 0;
						} else if (sym === 18) {
							const repeat = Math.min(readBits(7) + 11, hlit + hdist - idx);
							for (let r = 0; r < repeat; r++) combinedLengths[idx++] = 0;
						}
					}

					litTable = GeoTiffDecoder.buildHuffmanTree(combinedLengths.subarray(0, hlit));
					distTable = GeoTiffDecoder.buildHuffmanTree(combinedLengths.subarray(hlit));
				}

				while (true) {
					const sym = GeoTiffDecoder.decodeSymbol(readBits, litTable);
					if (sym === 256) break;
					if (sym < 256) {
						out[outIdx++] = sym;
					} else {
						const lenExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
						const lenBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
						const lenIdx = sym - 257;
						const length = lenBase[lenIdx] + readBits(lenExtra[lenIdx]);

						const distSym = GeoTiffDecoder.decodeSymbol(readBits, distTable);
						const distExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
						const distBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
						const distance = distBase[distSym] + readBits(distExtra[distSym]);

						let srcPtr = outIdx - distance;
						for (let k = 0; k < length; k++) {
							out[outIdx++] = out[srcPtr++];
						}
					}
				}
			}
		} while (!isFinal);

		return out.subarray(0, outIdx);
	}

	private static decodeSymbol(readBits: (n: number) => number, tree: number[]): number {
		let ptr = 0;
		while (tree[ptr] >= 0) {
			const bit = readBits(1);
			ptr = tree[ptr + bit];
		}
		return ~tree[ptr];
	}

	private static buildHuffmanTree(lengths: Uint8Array): number[] {
		const maxLen = 15;
		const blCount = new Uint16Array(maxLen + 1);
		for (let i = 0; i < lengths.length; i++) {
			if (lengths[i] > 0) blCount[lengths[i]]++;
		}

		const nextCode = new Uint16Array(maxLen + 1);
		let code = 0;
		for (let bits = 1; bits <= maxLen; bits++) {
			code = (code + blCount[bits - 1]) << 1;
			nextCode[bits] = code;
		}

		const tree = [0, 0];
		for (let i = 0; i < lengths.length; i++) {
			const len = lengths[i];
			if (len === 0) continue;

			let c = nextCode[len]++;
			let ptr = 0;

			for (let bit = len - 1; bit >= 0; bit--) {
				const b = (c >> bit) & 1;
				if (tree[ptr + b] === 0) {
					tree[ptr + b] = tree.length;
					tree.push(0, 0);
				}
				ptr = tree[ptr + b];
			}
			tree[ptr] = ~i;
		}
		return tree;
	}

	private static fixedLitTable: number[] | null = null;
	private static fixedDistTable: number[] | null = null;

	private static buildFixedLitTable(): number[] {
		if (!GeoTiffDecoder.fixedLitTable) {
			const lengths = new Uint8Array(288);
			for (let i = 0; i <= 143; i++) lengths[i] = 8;
			for (let i = 144; i <= 255; i++) lengths[i] = 9;
			for (let i = 256; i <= 279; i++) lengths[i] = 7;
			for (let i = 280; i <= 287; i++) lengths[i] = 8;
			GeoTiffDecoder.fixedLitTable = GeoTiffDecoder.buildHuffmanTree(lengths);
		}
		return GeoTiffDecoder.fixedLitTable;
	}

	private static buildFixedDistTable(): number[] {
		if (!GeoTiffDecoder.fixedDistTable) {
			const lengths = new Uint8Array(32);
			for (let i = 0; i < 32; i++) lengths[i] = 5;
			GeoTiffDecoder.fixedDistTable = GeoTiffDecoder.buildHuffmanTree(lengths);
		}
		return GeoTiffDecoder.fixedDistTable;
	}

	/**
	 * Typed predictor un-differencing for horizontal predictor (2) & floating-point predictor (3).
	 */
	private static applyPredictor(
		data: Uint8Array,
		width: number,
		height: number,
		bytesPerPixel: number,
		sampleFormat: number,
		predictor: number,
		littleEndian: boolean
	): void {
		const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);

		if (predictor === 2) {
			// Integer horizontal differencing
			for (let r = 0; r < height; r++) {
				const rowOffset = r * width * bytesPerPixel;
				for (let c = 1; c < width; c++) {
					const curr = rowOffset + c * bytesPerPixel;
					const prev = rowOffset + (c - 1) * bytesPerPixel;

					if (bytesPerPixel === 1) {
						data[curr] = (data[curr] + data[prev]) & 0xff;
					} else if (bytesPerPixel === 2) {
						if (sampleFormat === 2) {
							const val = dataView.getInt16(curr, littleEndian) + dataView.getInt16(prev, littleEndian);
							dataView.setInt16(curr, val, littleEndian);
						} else {
							const val = (dataView.getUint16(curr, littleEndian) + dataView.getUint16(prev, littleEndian)) & 0xffff;
							dataView.setUint16(curr, val, littleEndian);
						}
					} else if (bytesPerPixel === 4) {
						if (sampleFormat === 3) {
							// Float32 under Predictor 2 (standard additive difference)
							const val = dataView.getFloat32(curr, littleEndian) + dataView.getFloat32(prev, littleEndian);
							dataView.setFloat32(curr, val, littleEndian);
						} else {
							const val = (dataView.getUint32(curr, littleEndian) + dataView.getUint32(prev, littleEndian)) >>> 0;
							dataView.setUint32(curr, val, littleEndian);
						}
					}
				}
			}
		} else if (predictor === 3 && sampleFormat === 3) {
			// Floating point horizontal differencing (TIFF Tech Note 3: bytes are grouped by byte-planes)
			const rowBytes = width * bytesPerPixel;
			const tempRow = new Uint8Array(rowBytes);

			for (let r = 0; r < height; r++) {
				const rowStart = r * rowBytes;
				// Un-difference byte planes
				for (let i = 1; i < rowBytes; i++) {
					data[rowStart + i] = (data[rowStart + i] + data[rowStart + i - 1]) & 0xff;
				}

				// De-interleave byte planes
				tempRow.set(data.subarray(rowStart, rowStart + rowBytes));
				for (let c = 0; c < width; c++) {
					for (let b = 0; b < bytesPerPixel; b++) {
						const srcIdx = b * width + c;
						const dstIdx = littleEndian
							? c * bytesPerPixel + (bytesPerPixel - 1 - b)
							: c * bytesPerPixel + b;
						data[rowStart + dstIdx] = tempRow[srcIdx];
					}
				}
			}
		}
	}
}