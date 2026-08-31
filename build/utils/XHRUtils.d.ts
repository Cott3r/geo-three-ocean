export declare class XHRUtils {
    static maxConcurrentRequests: number;
    static maxRetries: number;
    static initialRetryDelayMs: number;
    static backoffFactor: number;
    private static activeRequestsCount;
    private static queue;
    static get activeRequests(): number;
    static get pendingRequests(): number;
    static resetQueue(): void;
    static enqueue<T>(task: () => Promise<T>): Promise<T>;
    static fetchWithRetry(url: string, options?: RequestInit, retries?: number, delayMs?: number): Promise<Response>;
    static get(url: string): Promise<any>;
    static getRaw(url: string): Promise<ArrayBuffer>;
    static fetchImage(url: string): Promise<HTMLImageElement>;
    static request(url: string, type: string, header?: any, body?: any, onLoad?: Function, onError?: Function, onProgress?: Function): XMLHttpRequest;
}
