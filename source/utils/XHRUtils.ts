/**
 * XHR utils contains public static methods to allow easy access to services via XHR and Fetch.
 * Includes concurrency throttling (Request Queue) and Exponential Backoff Retries.
 */
export class XHRUtils 
{
	/**
	 * Maximum number of concurrent network requests allowed.
	 */
	public static maxConcurrentRequests: number = 4;

	/**
	 * Maximum number of retry attempts for transient server/network errors (502, 504, 503, 429).
	 */
	public static maxRetries: number = 3;

	/**
	 * Initial delay in milliseconds before the first retry attempt.
	 */
	public static initialRetryDelayMs: number = 200;

	/**
	 * Backoff multiplier for exponential delay calculation between retries.
	 */
	public static backoffFactor: number = 2.0;

	private static activeRequestsCount: number = 0;
	private static queue: Array<() => void> = [];

	/**
	 * Gets the current count of active ongoing network requests.
	 */
	public static get activeRequests(): number 
	{
		return XHRUtils.activeRequestsCount;
	}

	/**
	 * Gets the number of pending queued requests waiting for execution.
	 */
	public static get pendingRequests(): number 
	{
		return XHRUtils.queue.length;
	}

	/**
	 * Resets the queue state and active request counter (useful for unit testing).
	 */
	public static resetQueue(): void 
	{
		XHRUtils.activeRequestsCount = 0;
		XHRUtils.queue = [];
	}

	/**
	 * Enqueues a network task, executing it when an active request slot is available.
	 */
	public static async enqueue<T>(task: () => Promise<T>): Promise<T> 
	{
		return new Promise<T>((resolve, reject) => 
		{
			const runTask = () => 
			{
				XHRUtils.activeRequestsCount++;
				task()
					.then(resolve)
					.catch(reject)
					.finally(() => 
					{
						XHRUtils.activeRequestsCount--;
						if (XHRUtils.queue.length > 0) 
						{
							const next = XHRUtils.queue.shift();
							if (next) 
							{
								next();
							}
						}
					});
			};

			if (XHRUtils.activeRequestsCount < XHRUtils.maxConcurrentRequests) 
			{
				runTask();
			} 
			else 
			{
				XHRUtils.queue.push(runTask);
			}
		});
	}

	/**
	 * Executes a fetch request wrapped in concurrency throttling and exponential backoff retry logic.
	 */
	public static async fetchWithRetry(
		url: string,
		options?: RequestInit,
		retries: number = XHRUtils.maxRetries,
		delayMs: number = XHRUtils.initialRetryDelayMs
	): Promise<Response> 
	{
		return XHRUtils.enqueue(async () => 
		{
			let attempt = 0;
			let currentDelay = delayMs;

			while (true) 
			{
				try 
				{
					const response = await fetch(url, options);

					// Retry on transient server/gateway errors or rate limits (502, 504, 503, 429)
					if (
						!response.ok &&
						(response.status === 502 || response.status === 504 || response.status === 503 || response.status === 429) &&
						attempt < retries
					) 
					{
						attempt++;
						const jitter = Math.random() * 50;
						const totalDelay = Math.round(currentDelay + jitter);
						console.warn(`[XHRUtils] Transient HTTP ${response.status} for ${url}. Retrying attempt ${attempt}/${retries} in ${totalDelay}ms...`);
						await new Promise((res) => setTimeout(res, totalDelay));
						currentDelay *= XHRUtils.backoffFactor;
						continue;
					}

					return response;
				} 
				catch (error) 
				{
					// Network or CORS errors caused by 502/504 responses
					if (attempt < retries) 
					{
						attempt++;
						const jitter = Math.random() * 50;
						const totalDelay = Math.round(currentDelay + jitter);
						console.warn(`[XHRUtils] Network error fetching ${url}. Retrying attempt ${attempt}/${retries} in ${totalDelay}ms...`);
						await new Promise((res) => setTimeout(res, totalDelay));
						currentDelay *= XHRUtils.backoffFactor;
						continue;
					}

					throw error;
				}
			}
		});
	}

	/**
	 * Get file data from URL as text, using fetch with retry and concurrency control.
	 *
	 * @param url - Target for the request.
	 */
	public static async get(url: string): Promise<any> 
	{
		const response = await XHRUtils.fetchWithRetry(url);
		if (!response.ok) 
		{
			throw new Error(`HTTP request failed with status ${response.status}`);
		}
		return await response.text();
	}

	/**
	 * Get raw file data from URL as ArrayBuffer, using fetch with retry and concurrency control.
	 *
	 * @param url - Target for the request.
	 */
	public static async getRaw(url: string): Promise<ArrayBuffer> 
	{
		const response = await XHRUtils.fetchWithRetry(url);
		if (!response.ok) 
		{
			throw new Error(`HTTP request failed with status ${response.status}`);
		}
		return await response.arrayBuffer();
	}

	/**
	 * Loads an image from a URL, wrapped in request queue concurrency control and exponential backoff retry logic.
	 *
	 * @param url - Target image URL.
	 */
	public static async fetchImage(url: string): Promise<HTMLImageElement> 
	{
		return XHRUtils.enqueue(async () => 
		{
			let attempt = 0;
			let currentDelay = XHRUtils.initialRetryDelayMs;

			while (true) 
			{
				try 
				{
					const img = await new Promise<HTMLImageElement>((resolve, reject) => 
					{
						const image = document.createElement('img');
						image.onload = () => resolve(image);
						image.onerror = (err) => reject(err);
						image.crossOrigin = 'Anonymous';
						image.src = url;
					});
					return img;
				} 
				catch (err) 
				{
					if (attempt < XHRUtils.maxRetries) 
					{
						attempt++;
						const jitter = Math.random() * 50;
						const totalDelay = Math.round(currentDelay + jitter);
						await new Promise((res) => setTimeout(res, totalDelay));
						currentDelay *= XHRUtils.backoffFactor;
						continue;
					}
					throw err;
				}
			}
		});
	}

	/**
	 * Perform a request with the specified configuration via XHR.
	 *
	 * @param url - Target for the request.
	 * @param type - Request type (POST, GET, ...)
	 * @param header - Object with data to be added to the request header.
	 * @param body - Data to be sent in the request.
	 * @param onLoad - On load callback, receives data (String or Object) and XHR as arguments.
	 * @param onError - XHR onError callback.
	 */
	public static request(url: string, type: string, header?: any, body?: any, onLoad?: Function, onError?: Function, onProgress?: Function): XMLHttpRequest 
	{
		function parseResponse(response: any): any 
		{
			try 
			{
				return JSON.parse(response);
			}
			catch (e) 
			{
				return response;
			}
		}

		const xhr = new XMLHttpRequest();
		xhr.overrideMimeType('text/plain');
		xhr.open(type, url, true);

		// Fill header data from Object
		if (header !== null && header !== undefined) 
		{
			for (const i in header) 
			{
				xhr.setRequestHeader(i, header[i]);
			}
		}

		if (onLoad !== undefined) 
		{
			xhr.onload = function(event) 
			{
				onLoad(parseResponse(xhr.response), xhr);
			};
		}

		if (onError !== undefined) 
		{
			// @ts-ignore
			xhr.onerror = onError;
		}

		if (onProgress !== undefined) 
		{
			// @ts-ignore
			xhr.onprogress = onProgress;
		}

		xhr.send(body !== undefined ? body : null);

		return xhr;
	}
}

