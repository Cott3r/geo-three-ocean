import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
    MapView,
    MapNode,
    MapPlaneNode,
    MapHeightNode,
    MapHeightNodeShader,
    MapMartiniHeightNode,
    MapSphereNode,
    DebugProvider,
    HeightDebugProvider
} from '../source/Main';

describe('Geo-Three native Three.js r185+ support', () => {
    it('verifies Three.js version is r185+', () => {
        const rev = parseInt(THREE.REVISION);
        expect(rev).toBeGreaterThanOrEqual(185);
    });

    it('verifies determinantAffine exists on MapNode instances (Item 4)', () => {
        const planeNode = new MapPlaneNode();
        expect(typeof planeNode.matrixWorld.determinantAffine).toBe('function');
        expect(planeNode.matrixWorld.determinantAffine()).toBe(1);

        const heightShaderNode = new MapHeightNodeShader();
        expect(typeof heightShaderNode.matrixWorld.determinantAffine).toBe('function');

        const sphereNode = new MapSphereNode();
        expect(typeof sphereNode.matrixWorld.determinantAffine).toBe('function');
    });

    it('verifies ColorSpace handling on texture creation (Item 1)', async () => {
        const planeNode = new MapPlaneNode();
        // Default texture color space
        expect(MapNode.defaultTexture.colorSpace).toBe(THREE.SRGBColorSpace);

        // Height texture color space
        expect(MapHeightNodeShader.defaultHeightTexture.colorSpace).toBe(THREE.NoColorSpace);

        // Mock canvas image for applyTexture
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;

        await planeNode.applyTexture(canvas as any);
        expect((planeNode.material as THREE.MeshBasicMaterial).map?.colorSpace).toBe(THREE.SRGBColorSpace);

        const sphereNode = new MapSphereNode();
        await sphereNode.applyTexture(canvas as any);
        expect(((sphereNode.material as THREE.ShaderMaterial).uniforms.uTexture.value as THREE.Texture).colorSpace).toBe(THREE.SRGBColorSpace);
    });

    it('verifies custom elevation shader injection and compilation (Item 2)', () => {
        const heightShaderNode = new MapHeightNodeShader();
        const mat = heightShaderNode.material as THREE.MeshPhongMaterial;

        expect(typeof mat.onBeforeCompile).toBe('function');

        // Simulate Three.js WebGLProgram onBeforeCompile hook
        const dummyShader = {
            uniforms: {},
            vertexShader: `
#include <common>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
    #include <uv_vertex>
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <normal_vertex>
    #include <begin_vertex>
    #include <displacementmap_vertex>
    #include <project_vertex>
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
}
            `,
            fragmentShader: `
void main() {
    gl_FragColor = vec4(1.0);
}
            `
        };

        mat.onBeforeCompile(dummyShader, {} as any);

        expect(dummyShader.uniforms).toHaveProperty('heightMap');
        expect(dummyShader.vertexShader).toContain('uniform sampler2D heightMap;');
        // Should inject displacement at begin_vertex
        expect(dummyShader.vertexShader).toContain('transformed += normal * _height;');
        // logdepthbuf_vertex should be preserved after displacement
        expect(dummyShader.vertexShader).toContain('#include <logdepthbuf_vertex>');
    });

    it('verifies node and material disposal behavior (Item 3)', () => {
        const mapView = new MapView(MapView.PLANAR, new DebugProvider());
        const root = mapView.root;
        expect(root).toBeDefined();

        const sharedGeom = MapPlaneNode.geometry;
        let sharedDisposed = false;
        sharedGeom.addEventListener('dispose', () => {
            sharedDisposed = true;
        });

        // Add instance geometry node
        const heightNode = new MapHeightNode();
        const dynamicGeom = new THREE.BufferGeometry();
        let dynamicDisposed = false;
        dynamicGeom.addEventListener('dispose', () => {
            dynamicDisposed = true;
        });
        heightNode.geometry = dynamicGeom;

        // Texture disposal tracking
        const dynTex = new THREE.Texture();
        let texDisposed = false;
        dynTex.addEventListener('dispose', () => {
            texDisposed = true;
        });
        (heightNode.material as any).map = dynTex;

        // Dispose height node
        heightNode.dispose();

        expect(dynamicDisposed).toBe(true);
        expect(texDisposed).toBe(true);
        expect(sharedDisposed).toBe(false);

        // MapView disposal
        mapView.dispose();
        expect(sharedDisposed).toBe(false);
    });

    it('verifies build/geo-three.module.js exports and functions', async () => {
        // @ts-ignore
        const build = await import('../build/geo-three.module.js');
        expect(build.MapView).toBeDefined();
        expect(build.MapPlaneNode).toBeDefined();
        expect(build.MapHeightNodeShader).toBeDefined();

        const plane = new build.MapPlaneNode();
        expect(typeof plane.matrixWorld.determinantAffine).toBe('function');
        expect(build.MapNode.defaultTexture.colorSpace).toBe(THREE.SRGBColorSpace);
        expect(build.MapHeightNodeShader.defaultHeightTexture.colorSpace).toBe(THREE.NoColorSpace);
    });
});
