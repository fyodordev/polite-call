import CallHandler from '../src/index';
const rewire = require('rewire');

const timeoutRewire = rewire('../dist/index');
const timeout = timeoutRewire.__get__('timeout');

const mockedFetch = jest.fn();
mockedFetch.mockImplementation((url: string) => {
    return Date.now();
});

function policeRateLim(result: number[], rateLim: number, interval: number) {
    let res = true;
    result.forEach((req) => {
        const arr = result.filter((val) => (val >= req && (val - req) < interval));
        if (arr.length > rateLim) res = false;
    });
    return res;
}

//
class Looper {
    private goOn = true;
    private func: Function;
    private interval: number;
    constructor(func: Function, interval = 5) {
        this.func = func;
        this.interval = interval;
    }
    public async startLoop() {
        while(this.goOn) {
            this.func();
            await new Promise((res) => {
                setTimeout(() => res(), this.interval);
            })
        }
    }
    public endLoop() {
        this.goOn = false;
    }
}

function getRange(result: number[]) {
    const min = Math.min(...result);
    const max = Math.max(...result);
    if (min && max) {
        return max - min;
    } else {
        throw new Error('should not be undefined');
    }
}

describe('custom timeout function', () => {
    const testArray = [...Array(30).keys()].map(i => 100);
    testArray.forEach((t: number) => {
        test('timeout is at least specified time', async () => {
            const timeA = Date.now();
            const timeB: number = (await timeout(t, () => Date.now())) as number;
            expect(timeB - timeA).toBeGreaterThanOrEqual(t);
        });
    });

    test('timeout is at least specified time, works without function', async () => {
        const timeA = Date.now();
        await timeout(100);
        const timeB = Date.now();
        expect(timeB - timeA).toBeGreaterThanOrEqual(100);
    });
});

describe('RequestHandler', () => {
    //Test by wrapping calls to fetch in a function that fails when there's too many requests in a certain time.
    // Parametrize both by nr. of reqs and interval to test the test also
    
    beforeEach(() => {
        mockedFetch.mockReset();
    });

    test('mock fetch is executed', async () => {
        const reqHandler = new CallHandler(3, 1000);

        await reqHandler.call(async () => {
            return await mockedFetch(`testurl`);
        });

        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    test('period length 0 executes requests at once', async () => {
        mockedFetch.mockImplementation(() => Date.now());

        const reqHandler = new CallHandler(0, 0);
        const result: number[] = [];
        for(let i = 0; i  < 100; i++) {
            result.push(Number(await reqHandler.call(async () => {
                return await mockedFetch(`url${i}`);
            })))
        }

        expect(mockedFetch).toHaveBeenCalledTimes(100);
        expect(result.length).toBe(100);
        expect(mockedFetch).toHaveBeenNthCalledWith(1, 'url0');
        expect(mockedFetch).toHaveBeenNthCalledWith(2, 'url1');
        expect(mockedFetch).toHaveBeenNthCalledWith(3, 'url2');

        expect(getRange(result)).toBeLessThan(50);
    });

    test('everything below rate limit executes at once', async () => {
        mockedFetch.mockImplementation(() => Date.now());

        const reqHandler = new CallHandler(100, 1000);
        const result: number[] = [];
        for(let i = 0; i  < 100; i++) {
            result.push(Number(await reqHandler.call(async () => {
                return await mockedFetch(`url${i}`);
            })))
        }

        expect(mockedFetch).toHaveBeenCalledTimes(100);
        expect(result.length).toBe(100);
        expect(mockedFetch).toHaveBeenNthCalledWith(1, 'url0');
        expect(mockedFetch).toHaveBeenNthCalledWith(2, 'url1');
        expect(mockedFetch).toHaveBeenNthCalledWith(3, 'url2');

        expect(getRange(result)).toBeLessThan(50);
    });

    test('If an error occurs no other requests get through until error is resolved', async () => {
        // test with period length 0
        mockedFetch.mockImplementation(() => {
            throw new Error('error123');
        });
        const secondFetch = jest.fn(() => Date.now());

        //const reqHandler = new RequestHandler(1, 100);
        const reqHandler = new CallHandler(0, 0, (err, attempts) => {
                if (attempts < 3) {
                    return 100 * (2 ** attempts);
                } else {
                    return undefined;
                }
        });

        const func = async () => reqHandler.call(() => secondFetch());
        const looper = new Looper(func, 20);

        let promise;
        let error;
        const timeA = Date.now();
        try{
            promise = reqHandler.call(async () => {
                return await mockedFetch(`url`);
            });
            looper.startLoop();
            await promise;
        } catch(e) {
            looper.endLoop();
            error = e;
        }
        const delta = Date.now() - timeA;

        expect(delta).toBeLessThan(800);
        expect(delta).toBeGreaterThanOrEqual(700);
        expect(error).toBeTruthy();
        expect(error.message).toEqual('error123');
        expect(mockedFetch).toHaveBeenCalledTimes(4);
        expect(secondFetch.mock.calls.length).toBeLessThanOrEqual(2);
    });

    test('requests over limit are delayed', async () => {
        mockedFetch.mockImplementation(() => Date.now());

        const reqHandler = new CallHandler(3, 1005);
        const result: number[] = [];
        for(let i = 0; i  < 9; i++) {
            result.push(Number(await reqHandler.call(async () => {
                return await mockedFetch(`url${i}`);
            })));
        }
        expect(mockedFetch).toHaveBeenCalledTimes(9);
        expect(result.length).toEqual(9);
        expect(policeRateLim(result, 3, 1000)).toEqual(true);

    });

    function testErrors(pLength: number, totalTime: number, timesCalled: number, retryArg?: number) {
        test(`Retry on error with default exponential backoff ${retryArg} times`, async () => {
            mockedFetch.mockImplementation(() => {
                throw new Error('error123');
            });

            const reqHandler = new CallHandler(3, pLength, retryArg);
            const result: number[] = [];
            let error;
            const timeA = Date.now();
            try{
                result.push(Number(await reqHandler.call(async () => {
                    return await mockedFetch(`url`);
                })));
            } catch(e) {
                error = e;
            }
            const delta = Date.now() - timeA;
            expect(delta).toBeLessThan(totalTime + 100);
            expect(delta).toBeGreaterThanOrEqual(totalTime);
            expect(error).toBeTruthy();
            expect(error.message).toEqual('error123');
            expect(mockedFetch).toHaveBeenCalledTimes(timesCalled);
            expect(result.length).toEqual(0);
        });
    }
    testErrors(100, 700, 4);
    testErrors(100, 3100, 6, 5);
    testErrors(100, 0, 1, 0);

    test('Requests return normally if resolved after backoff and backoff as function argument works', async () => {
        mockedFetch
        .mockImplementationOnce(() => {
            throw new Error('error123');
        })
        .mockImplementationOnce((url) => url);
        
        const reqHandler = new CallHandler(1, 300, (err, nr) => {
            if (err.message === 'error123') {
                return 1300;
            } else {
                return undefined;
            }
        });

        let error;
        let result;
        const timeA = Date.now();
        try{
            result = await reqHandler.call(async () => {
                return await mockedFetch(`test_url`);
            });
        } catch(e) {
            error = e;
        }
        const delta = Date.now() - timeA;
        expect(error).toBeFalsy();
        expect(result).toEqual('test_url');
        expect(mockedFetch).toHaveBeenCalledTimes(2);
        expect(delta).toBeGreaterThanOrEqual(1300);
    });

    test('When backoff stops from a queue, function passes error upward, and promises work', async () => {
        mockedFetch
        .mockImplementation(() => {
            throw new Error('error123');
        })
        .mockImplementationOnce((url) => {
            return new Promise((res, rej) => {
                setTimeout(() => {
                    res(url); 
                });
            });
        });

        const reqHandler = new CallHandler(1, 20);
        let error;
        let result;
        try{
            result = await reqHandler.call(() => mockedFetch(`test_url`));
            await reqHandler.call(() => mockedFetch(`test_url`));
        } catch(e) {
            error = e;
        }
        expect(error).toBeTruthy();
        expect(error.message).toEqual('error123');
        expect(result).toEqual('test_url');
        expect(mockedFetch).toHaveBeenCalledTimes(5);
    });
});