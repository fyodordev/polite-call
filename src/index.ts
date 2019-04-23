// Objects that represent one request and which will be held in the queue.
interface Request {
    func: Function,
    passPromise?: (promise: Promise<object>) => void
}

// Ensures timeout is respected accurately by calling setTimeout multiple times if need be.
async function timeout(waitTime: number, func?: () => any): Promise<any> {
    if (waitTime > 0) {
        const startTime = Date.now();
        let delta = 0;
        do {
            await new Promise((res) => setTimeout(() => res(), waitTime - delta));
            delta = Date.now() - startTime;
        } while(delta < waitTime);
    }
    return (func ? await func() : await undefined);
}

export default class CallHandler {
    private rateLim: number; // Maximum allowed nr. of request in period.
    private periodLength: number; // Length of period for which rate limit applies.
    // Backoff function. Takes number of previous attempts and error and calculates returns either wait time or undefined.
    private getBackoff: (error: Error, attemptNr: number) => number | undefined; // Backoff function on error
    // Number of requests made in the last period.
    private requestsLastPeriod = 0;
    // Queue of requests. Should be empty if requestsLastPeriod < rateLim
    private queue: Request[] = [];

    // Backoff is either function that determines how long to wait for the next retry or number denoting the number of retries to make.
    constructor(rateLim: number, periodLength: number, backoff: ((error: Error, attemptNr: number) => number | undefined) | number = 3) {
        this.rateLim = (rateLim < 1 ? 1 : rateLim);
        this.periodLength = periodLength;

        if (typeof(backoff) === 'number') {
            this.getBackoff = (e: Error, attemptNr: number) => {
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

    // Execute a function after rate limit has been respected and return either result or error after retries. 
    public call(func: Function): Promise<object> {
        // Decide whether to send request now or add to queue
        if (this.requestsLastPeriod < this.rateLim) {
            return this.sendReq(func);
        } else {
            return this.sendQueue(func);
        }
    }

    // Add a request to the queue to execute at a later time and return its promise.
    private sendQueue(request: Function): Promise<object> {
        // Queue request and inject function to get promise from sendReq method.
        return new Promise((res, rej) => {
            function passPromise(promise: Promise<object>): void {
                promise.then((val) => {
                    res(val);
                }).catch((e) => rej(e));
            }
            this.queue.push({
                func: request,
                passPromise
            })
        });
    }

    //Call function immediately, and retry on error according to the backoff function. 
    private async sendReq(request: Function, attemptNr: number = 0): Promise<object> {
        try {
            const reqPromise = request();
            this.blockRequests(timeout(this.periodLength));
            return await reqPromise;
        } catch(e) {
            // If error, execute function to calculate backoff time.
            // Halt new all new requests from being executed, wait for x amount of ms, then retry y amount, while transforming
            // x with certain function. If unsuccessful after last try pass error upwards.

            const wait = this.getBackoff(e, attemptNr);
            if (wait) {
                const result = timeout(wait, () => this.sendReq(request, attemptNr + 1));
                this.blockRequests(result, this.rateLim)
                return await result;
            } else {
                // If getBackoff returns undefined that means no more retries should be made and error passed upward.
                throw e;
            }
        }
    }

    // Add certain number to number of requests for certain period of time, then execute a function.
    private async blockRequests(promise: Promise<any>, amount = 1): Promise<void> {
        this.requestsLastPeriod = this.requestsLastPeriod + amount;
        try {
            await promise;
        } finally {
            this.requestsLastPeriod = this.requestsLastPeriod - amount;
            return await this.checkQueue();
        }
    }

    // Check if there's room for a request, and if so pop it off the queue, execute request and pass promise.
    // Do so as long as there is room for requests which are still in the queue.
    private checkQueue() {
        while (this.requestsLastPeriod < this.rateLim && this.queue.length > 0) {
            // New requests should be popped off the queue here as long there is room for requests.
            const re = this.queue.shift();
            if (re && re.passPromise) { re.passPromise(this.sendReq(re.func)) };
        }
    }
}
