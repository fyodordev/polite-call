// Function which represents and is executed as the desired request.
type requestFunc = () => Promise<any>;

// Objects that represent one request and which will be held in the queue.
export interface Request {
    func: requestFunc,
    passPromise?: (promise: Promise<object>) => void
}

// Handle request, especially to respect rate limits. Errors concerning rate limit violation or connection
// problem are handled here. Retry 3 times, after that pass error upwards.
export class RequestHandler {
    // Set rate limit to 100 requests per second (+ 5ms to be safe).
    private rateLim: number = 100; // Maximum allowed nr. of request in period.
    private periodLength: number = 1005; // Length of period for which rateLim applies.
    private retry = 3;
    private trans = (w: number) => w * 2;

    // Number of requests made in the last period.
    private requestsLastPeriod: number = 0;
    // Queue of requests. Should be empty if requestsLastPeriod < rateLim
    private queue: Request[] = [];

    constructor(rateLim: number, periodLength: number, trans?: (x: number) => number, retry?: number) {
        this.rateLim = rateLim;
        this.periodLength = periodLength;
        if(trans) this.trans = trans;
        if(retry) this.retry = retry;
    }

    /**
     * Decide  whether to send request now or add to queue
     * @see this.requestsLastPeriod, this.rateLim
     * @see this.sendReq
     * @see this.sendQueue
     * @param request Request object with endpoint and parameters
     */
    public get(func: requestFunc): Promise<object> {
        if (this.requestsLastPeriod < this.rateLim) {
            return this.sendReq(func);
        } else {
            return this.sendQueue(func);
        }
    }

    /**
     * Add a request to the queue to execute at a later time and return promise
     * @see this.queue
     * @param request the Request parameters to add to queue to send at later time
     * @returns Promise that resolves with request result, when request is handled
     */
    private sendQueue(request: requestFunc): Promise<object> {
        // Queue request and inject function to get promise from sendReq method.
        return new Promise((res, rej) => {
            function passPromise(promise: Promise<object>): void {
                promise.then((val) => {
                    res(val);
                }).catch(() => rej());
            }
            this.queue.push({
                func: request,
                passPromise
            })
        });
    }

    /** Responsible for sending the request, and retrying with appropriate backoff while halting all other requests 
     * if an error occurs
     * @see this.requestsLastPeriod
     * @see this.updateRateLim
     * @see this.periodLength
     * @param request 
     * @param wait 
     * @param retry 
     * @param trans 
     */
    private async sendReq(request: requestFunc, wait: number = this.periodLength, retry = this.retry): Promise<object> {
        try {
            const reqPromise = request();
            this.blockRequests();
            return await reqPromise;
        } catch(e) {
            // If error, halt everything and retry 3 times with increasing intervals
            // Halt new requests from being executed, wait for x amount of ms, then retry y amount, while transforming
            // x with certain function. If unsuccessful after last try pass error upwards
            if (retry > 0) {
                await this.blockRequests(this.rateLim, wait, () => {});
                const result = await this.sendReq(request, this.trans(wait), --retry);
                this.checkQueue();
                return result;
            } else {
                throw e;
            }
        }
    }

    /** Add certain number to number of requests for certain period of time, then execute a function.
     * @param amount Amount of requests which to block
     * @param time Time for which to block
     * @param fn Function to execute at the end of block
     */
    private blockRequests(amount = 1, time = this.periodLength, fn = this.checkQueue): Promise<void> {
        this.requestsLastPeriod = this.requestsLastPeriod + amount;
        const instance: RequestHandler = this;
        return new Promise((res) => {
            setTimeout(() => {
                instance.requestsLastPeriod = instance.requestsLastPeriod - amount;
                fn.bind(instance)();
                res();
            }, time);
        });
    }

    /** Check if there's room for a requests, and if so pop it off the queue, execute request and pass promise
     * Do so as long as there is room for requests which are still in the queue.
     * @see this.requestsLastPeriod
     * @see this.rateLim
     * @see this.queue
     * @see this.sendReq
     */
    private checkQueue() {
        while (this.requestsLastPeriod < this.rateLim && this.queue.length > 0) {
            // New requests should be popped off the queue here as long there is room for requests.
            const re = this.queue.shift();
            if (re && re.passPromise) { re.passPromise(this.sendReq(re.func)) };
        }
    }
}