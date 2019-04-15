// Function which represents and is executed as the desired request.
type requestFunc = () => Promise<any>;

// Objects that represent one request and which will be held in the queue.
export interface Request {
    func: requestFunc,
    passPromise?: (promise: Promise<object>) => void
}

// Ensures timeout is respected accurately by calling setTimeout multiple times if need be.
async function timeout(func: () => any, waitTime: number): Promise<any> {
    const startTime = Date.now();
    let delta = 0;
    do {
        await new Promise((res) => setTimeout(() => res(), waitTime - delta));
        delta = Date.now() - startTime;
    } while(delta < waitTime);
    return await func();
}

// Handle request, especially to respect rate limits. Errors concerning rate limit violation or connection
// problem are handled here. Retry 3 times, after that pass error upwards.
export class RequestHandler {
    // Set rate limit to 100 requests per second (+ 5ms to be safe).
    private rateLim: number = 100; // Maximum allowed nr. of request in period.
    private periodLength: number = 1005; // Length of period for which rateLim applies.

    // Backoff function. Takes number of previous attempts and error and calculates returns either wait time or undefined.
    private getBackoff: (error: object, attemptNr: number) => number | undefined; // Backoff function on error

    // Number of requests made in the last period.
    private requestsLastPeriod: number = 0;
    // Queue of requests. Should be empty if requestsLastPeriod < rateLim
    private queue: Request[] = [];

    // Backoff is either function that determines how long to wait for the next retry or number denoting the number of retries to make.
    constructor(rateLim: number, periodLength: number, backoff: ((error: object, attemptNr: number) => number | undefined) | number = 3) {
        this.rateLim = rateLim;
        this.periodLength = periodLength;

        if (typeof(backoff) === 'number') {
            this.getBackoff = (error: object, attemptNr: number) => {
                if (attemptNr < backoff) {
                    return periodLength * (2 ** attemptNr);
                } else {
                    return undefined;
                }
            }
        } else {
            this.getBackoff = backoff;
        }
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
    private async sendReq(request: requestFunc, attemptNr: number = 0): Promise<object> {
        try {
            const reqPromise = request();
            this.blockRequests();
            return await reqPromise;
        } catch(e) {
            // If error, execute function to calculate backoff time.
            // Halt new all new requests from being executed, wait for x amount of ms, then retry y amount, while transforming
            // x with certain function. If unsuccessful after last try pass error upwards.
            const wait = this.getBackoff(e, attemptNr);
            if (wait) {
                await this.blockRequests(this.rateLim, wait, () => {});
                const result = await this.sendReq(request, attemptNr + 1);
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
        return timeout(() => {
            instance.requestsLastPeriod = instance.requestsLastPeriod - amount;
            fn.bind(instance)();
        }, time);
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

