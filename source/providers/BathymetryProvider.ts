import {MapProvider} from './MapProvider';

/**
 * SeaSee Bathymetry tile provider.
 * Fetches Terrain-RGB elevation tiles from SeaSee backend bathymetry endpoint.
 */
export class BathymetryProvider extends MapProvider 
{
	/**
	 * Base URL for the bathymetry tile service endpoint.
	 * Default: http://localhost:8000/bathymetry
	 */
	public address: string;

	/**
	 * Map image tile format.
	 */
	public format: string;

	public constructor(address: string = 'http://localhost:8000/bathymetry') 
	{
		super();

		this.name = 'Bathymetry';
		this.address = address;
		this.format = 'png';
		this.minZoom = 0;
		this.maxZoom = 24;
	}

	public fetchTile(zoom: number, x: number, y: number): Promise<any> 
	{
		return new Promise<HTMLImageElement>((resolve, reject) => 
		{
			const image = document.createElement('img');
			image.onload = function() 
			{
				resolve(image);
			};
			image.onerror = function() 
			{
				reject();
			};
			image.crossOrigin = 'Anonymous';

			const cleanAddress = this.address.endsWith('/') ? this.address.slice(0, -1) : this.address;
			image.src = `${cleanAddress}/${zoom}/${x}/${y}.${this.format}`;
		});
	}
}
