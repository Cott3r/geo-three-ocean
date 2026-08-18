import {BufferGeometry, Float32BufferAttribute, Vector3} from 'three';
import {MapNodeGeometry} from './MapNodeGeometry';

export class MapNodeHeightGeometry extends BufferGeometry
{
	/**
	 * Map node geometry constructor.
	 *
	 * @param width - Width of the node.
	 * @param height - Height of the node.
	 * @param widthSegments - Number of subdivisions along the width.
	 * @param heightSegments - Number of subdivisions along the height.
	 * @param skirt - Skirt around the plane to mask gaps between tiles.
	 */
	public constructor(width: number = 1.0, height: number = 1.0, widthSegments: number = 1.0, heightSegments: number = 1.0, skirt: boolean = false, skirtDepth: number = 10.0, imageData: ImageData = null, calculateNormals: boolean = true)
	{
		super();

		// Buffers
		const indices = [];
		const vertices = [];
		const normals = [];
		const uvs = [];

		// Build plane
		MapNodeGeometry.buildPlane(width, height, widthSegments, heightSegments, indices, vertices, normals, uvs);

		const data = imageData.data;

		for (let i = 0, j = 0; i < data.length && j < vertices.length; i += 4, j += 3) 
		{
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];

			// The value will be composed of the bits RGB
			const value = (r * 65536 + g * 256 + b) * 0.1 - 1e4;

			vertices[j + 1] = value;
		}

		// Generate the skirt
		if (skirt)
		{
			MapNodeGeometry.buildSkirt(width, height, widthSegments, heightSegments, skirtDepth, indices, vertices, normals, uvs);
		}

		this.setIndex(indices);
		this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
		this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
		this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));

		if (calculateNormals)
		{
			this.computeNormals(widthSegments, heightSegments);
		}
	}

	/**
	 * Compute normals for the height geometry.
	 * 
	 * Only computes normals for the surface of the map geometry. Skirts are not considered.
	 * 
	 * @param widthSegments - Number of segments in width.
	 * @param heightSegments - Number of segments in height.
	 */
	public computeNormals(widthSegments: number, heightSegments: number): void 
	{
		const positionAttribute = this.getAttribute('position');
		const normalAttribute = this.getAttribute('normal');
	
		if (positionAttribute !== undefined && normalAttribute !== undefined)
		{
			const gridX = widthSegments + 1;
			const gridZ = heightSegments + 1;
			const segmentWidth = 1.0 / widthSegments;
			const segmentHeight = 1.0 / heightSegments;

			const n = new Vector3();

			for (let iz = 0; iz < gridZ; iz++)
			{
				for (let ix = 0; ix < gridX; ix++)
				{
					const idx = iz * gridX + ix;

					// Compute dy/dx
					let dydx: number;
					if (ix === 0)
					{
						const yRight = positionAttribute.getY(iz * gridX + 1);
						const yCurr = positionAttribute.getY(idx);
						dydx = (yRight - yCurr) / segmentWidth;
					}
					else if (ix === gridX - 1)
					{
						const yCurr = positionAttribute.getY(idx);
						const yLeft = positionAttribute.getY(iz * gridX + (gridX - 2));
						dydx = (yCurr - yLeft) / segmentWidth;
					}
					else
					{
						const yRight = positionAttribute.getY(iz * gridX + (ix + 1));
						const yLeft = positionAttribute.getY(iz * gridX + (ix - 1));
						dydx = (yRight - yLeft) / (2.0 * segmentWidth);
					}

					// Compute dy/dz
					let dydz: number;
					if (iz === 0)
					{
						const yDown = positionAttribute.getY(1 * gridX + ix);
						const yCurr = positionAttribute.getY(idx);
						dydz = (yDown - yCurr) / segmentHeight;
					}
					else if (iz === gridZ - 1)
					{
						const yCurr = positionAttribute.getY(idx);
						const yUp = positionAttribute.getY((gridZ - 2) * gridX + ix);
						dydz = (yCurr - yUp) / segmentHeight;
					}
					else
					{
						const yDown = positionAttribute.getY((iz + 1) * gridX + ix);
						const yUp = positionAttribute.getY((iz - 1) * gridX + ix);
						dydz = (yDown - yUp) / (2.0 * segmentHeight);
					}

					// Surface normal N = (-dydx, 1, -dydz) normalized
					n.set(-dydx, 1.0, -dydz).normalize();
					normalAttribute.setXYZ(idx, n.x, n.y, n.z);
				}
			}

			// Skirt vertices (if present) set normal to (0, 1, 0)
			const totalVertices = positionAttribute.count;
			const planeVertices = gridX * gridZ;
			for (let i = planeVertices; i < totalVertices; i++)
			{
				normalAttribute.setXYZ(i, 0, 1, 0);
			}

			normalAttribute.needsUpdate = true;
		}
	}
}
