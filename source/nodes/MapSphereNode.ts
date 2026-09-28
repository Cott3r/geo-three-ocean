import {Matrix4, BufferGeometry, Quaternion, Vector3, Raycaster, Intersection, ShaderMaterial, Texture, Vector4, SRGBColorSpace, LinearFilter, RGBAFormat} from 'three';
import {MapNode, QuadTreePosition} from './MapNode';
import {MapSphereNodeGeometry} from '../geometries/MapSphereNodeGeometry';
import {UnitsUtils} from '../utils/UnitsUtils';

/** 
 * Represents a map tile node.
 * 
 * A map node can be subdivided into other nodes (Quadtree).
 */
export class MapSphereNode extends MapNode 
{	
	/**
	 * Base geometry contains the entire globe.
	 * 
	 * Individual geometries generated for the sphere nodes are not based on this base geometry.
	 * 
	 * Applied to the map view on initialization.
	 */
	public static baseGeometry: BufferGeometry = (() => {
		const geom = new MapSphereNodeGeometry(UnitsUtils.EARTH_RADIUS, 64, 64, 0, 2 * Math.PI, 0, Math.PI);
		(geom as any).isSharedGeometry = true;
		return geom;
	})();

	/**
	 * Base scale of the node.
	 * 
	 * Applied to the map view on initialization.
	 */
	public static baseScale: Vector3 = new Vector3(1, 1, 1);

	/**
	 * Number of segments per node geometry.
	 * 
	 * Can be configured globally and is applied to all nodes.
	 */
	public static segments: number = 80;

	public constructor(parentNode = null, mapView = null, location = QuadTreePosition.root, level = 0, x = 0, y = 0) 
	{
		let bounds = UnitsUtils.tileBounds(level, x, y);

		// Load shaders
		const vertexShader = `
		#include <common>
		#include <logdepthbuf_pars_vertex>

		varying vec3 vPosition;

		void main() {
			vPosition = position;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

			#include <logdepthbuf_vertex>
		}
		`;

		const fragmentShader = `
		#include <common>
		#include <logdepthbuf_pars_fragment>

		#define PI 3.1415926538
		varying vec3 vPosition;
		uniform sampler2D uTexture;
		uniform vec4 webMercatorBounds;

		void main() {
			#include <logdepthbuf_fragment>

			// this could also be a constant, but for some reason using a constant causes more visible tile gaps at high zoom
			float radius = length(vPosition);

			float latitude = asin(vPosition.y / radius);
			float longitude = atan(-vPosition.z, vPosition.x);

			float web_mercator_x = radius * longitude;
			float web_mercator_y = radius * log(tan(PI / 4.0 + latitude / 2.0));
			float y = (web_mercator_y - webMercatorBounds.z) / webMercatorBounds.w;
			float x = (web_mercator_x - webMercatorBounds.x) / webMercatorBounds.y;

			vec4 color = texture2D(uTexture, vec2(x, y));
			gl_FragColor = color;

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
		}
		`;
		
		// Create shader material
		let vBounds = new Vector4(...bounds);
		const material = new ShaderMaterial({
			uniforms: {uTexture: {value: MapNode.defaultTexture}, webMercatorBounds: {value: vBounds}},
			vertexShader: vertexShader,
			fragmentShader: fragmentShader
		});

		super(parentNode, mapView, location, level, x, y, MapSphereNode.createGeometry(level, x, y), material);
	
		this.applyScaleNode();
	
		this.matrixAutoUpdate = false;
		this.isMesh = true;
		this.visible = false;
	}
	
	public async initialize(): Promise<void>
	{
		super.initialize();
		
		await this.loadData();
		
		this.nodeReady();
	}

	/**
	 * Create a geometry for a sphere map node.
	 *
	 * @param zoom - Zoom level to generate the geometry for.
	 * @param x - X tile position.
	 * @param y - Y tile position.
	 */
	public static createGeometry(zoom: number, x: number, y: number): MapSphereNodeGeometry
	{
		const range = Math.pow(2, zoom);
		const max = 40;
		const segments = Math.floor(MapSphereNode.segments * (max / (zoom + 1)) / max);
	
		// X
		const lon1 = x > 0 ? UnitsUtils.webMercatorToLongitude(zoom, x) + Math.PI : 0;
		const lon2 = x < range - 1 ? UnitsUtils.webMercatorToLongitude(zoom, x+1) + Math.PI : 2 * Math.PI;
		const phiStart = lon1;
		const phiLength = lon2 - lon1;
		
		// Y
		const lat1 = y > 0 ? UnitsUtils.webMercatorToLatitude(zoom, y) : Math.PI / 2;
		const lat2 = y < range - 1 ? UnitsUtils.webMercatorToLatitude(zoom, y+1) : -Math.PI / 2;
		const thetaLength = lat1 - lat2;
		const thetaStart = Math.PI - (lat1 + Math.PI / 2);

		return new MapSphereNodeGeometry(1, segments, segments, phiStart, phiLength, thetaStart, thetaLength);
	}
	
	public async applyTexture(image: HTMLImageElement): Promise<void>
	{		
		if (this.disposed) 
		{
			return;
		}

		const texture = new Texture(image);
		texture.colorSpace = SRGBColorSpace;
		texture.generateMipmaps = false;
		texture.format = RGBAFormat;
		texture.magFilter = LinearFilter;
		texture.minFilter = LinearFilter;
		texture.needsUpdate = true;

		// @ts-ignore
		const oldTexture = this.material.uniforms?.uTexture?.value;
		if (oldTexture && oldTexture !== MapNode.defaultTexture && typeof oldTexture.dispose === 'function')
		{
			oldTexture.dispose();
		}

		// @ts-ignore
		this.material.uniforms.uTexture.value = texture;
		// @ts-ignore
		this.material.uniforms.uTexture.needsUpdate = true;
	}

	/** 
	 * Apply scale and offset position to the sphere node geometry.
	 */
	public applyScaleNode(): void
	{
		this.geometry.computeBoundingBox();
	
		const box = this.geometry.boundingBox.clone();
		const center = box.getCenter(new Vector3());
	
		const matrix = new Matrix4();
		matrix.compose(new Vector3(-center.x, -center.y, -center.z), new Quaternion(), new Vector3(UnitsUtils.EARTH_RADIUS, UnitsUtils.EARTH_RADIUS, UnitsUtils.EARTH_RADIUS));
		this.geometry.applyMatrix4(matrix);
	
		this.position.copy(center);
	
		this.updateMatrix();
		this.updateMatrixWorld();
	}
	
	public updateMatrix(): void
	{
		this.matrix.setPosition(this.position);
		this.matrixWorldNeedsUpdate = true;
	}
	
	public updateMatrixWorld(force: boolean = false): void
	{
		if (this.matrixWorldNeedsUpdate || force) 
		{
			this.matrixWorld.copy(this.matrix);
			this.matrixWorldNeedsUpdate = false;
		}
	}
	
	public createChildNodes(): void
	{
		const level = this.level + 1;
		const x = this.x * 2;
		const y = this.y * 2;

		const Constructor = Object.getPrototypeOf(this).constructor;

		let node = new Constructor(this, this.mapView, QuadTreePosition.topLeft, level, x, y);
		this.add(node);

		node = new Constructor(this, this.mapView, QuadTreePosition.topRight, level, x + 1, y);
		this.add(node);

		node = new Constructor(this, this.mapView, QuadTreePosition.bottomLeft, level, x, y + 1);
		this.add(node);

		node = new Constructor(this, this.mapView, QuadTreePosition.bottomRight, level, x + 1, y + 1);
		this.add(node);
	}
	
	/**
	 * Overrides normal raycasting, to avoid raycasting when isMesh is set to false.
	 */
	public raycast(raycaster: Raycaster, intersects: Intersection[]): void
	{
		if (this.isMesh === true) 
		{
			super.raycast(raycaster, intersects);
		}
	}

	public dispose(): void
	{
		if (this.disposed)
		{
			return;
		}

		// @ts-ignore
		if (this.material && this.material.uniforms?.uTexture?.value)
		{
			// @ts-ignore
			const tex = this.material.uniforms.uTexture.value;
			if (tex && tex !== MapNode.defaultTexture && typeof tex.dispose === 'function')
			{
				tex.dispose();
				// @ts-ignore
				this.material.uniforms.uTexture.value = null;
			}
		}

		super.dispose();
	}
}
