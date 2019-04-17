import { RequestHandler } from '../src/main';
const rewire = require('rewire');

const timeoutRewire = rewire('../lib/main');
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

describe('custom timeout function', () => {
    const testArray = [...Array(30).keys()].map(i => 100);
    testArray.forEach((t: number) => {
        test('timeout is at least specified time', async () => {
            const timeA = Date.now();
            const timeB: number = (await timeout(() => Date.now(), t)) as number;
            expect(timeB - timeA).toBeGreaterThanOrEqual(t);
        });
    })
});

describe('RequestHandler', () => {
    //Test by wrapping calls to fetch in a function that fails when there's too many requests in a certain time.
    // Parametrize both by nr. of reqs and interval to test the test also
    
    beforeEach(() => {
        mockedFetch.mockClear();
    });

    test('mock fetch is executed', async () => {
        const reqHandler = new RequestHandler(3, 1000);

        await reqHandler.get(async () => {
            return await mockedFetch(`testurl`);
        });

        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    test('requests under limit are executed at once', async () => {
        const reqHandler = new RequestHandler(3, 1000);

        const result: number[] = [];
        for(let i = 0; i  < 3; i++) {
            result.push(Number(await reqHandler.get(async () => {
                return await mockedFetch(`url${i}`);
            })))
            // await new Promise((res) => setTimeout(() => res(), 100));
        }
        expect(mockedFetch).toHaveBeenCalledTimes(3);
        expect(result.length).toBe(3);
        expect(mockedFetch).toHaveBeenNthCalledWith(1, 'url0');
        expect(mockedFetch).toHaveBeenNthCalledWith(2, 'url1');
        expect(mockedFetch).toHaveBeenNthCalledWith(3, 'url2');

        const min = Math.min(...result);
        const max = Math.max(...result);
        if (min && max) {
            expect(max - min).toBeLessThan(100);
        } else {
            throw new Error('should not be undefined');
        }
    });

    test('requests over limit are delayed', async () => {
        const reqHandler = new RequestHandler(3, 1005);

        const result: number[] = [];
        for(let i = 0; i  < 9; i++) {
            result.push(Number(await reqHandler.get(async () => {
                return await mockedFetch(`url${i}`);
            })));
            // await new Promise((res) => setTimeout(() => res(), 100));
        }
        expect(mockedFetch).toHaveBeenCalledTimes(9);
        expect(result.length).toEqual(9);
        expect(policeRateLim(result, 3, 1000)).toEqual(true);

    });

    test('Consecutive errors get retried with default exponential backoff 3 times', async () => {
        mockedFetch.mockImplementation(() => {
            throw new Error('error123');
        });

        const reqHandler = new RequestHandler(3, 400);
        const result: number[] = [];
        let error;
        const timeA = Date.now();
        try{
            result.push(Number(await reqHandler.get(async () => {
                return await mockedFetch(`url`);
            })));
        } catch(e) {
            error = e;
        }
        const delta = Date.now() - timeA;
        expect(delta).toBeLessThan(2900);
        expect(delta).toBeGreaterThan(2700);
        expect(error).toBeTruthy();
        expect(error.message).toEqual('error123');
        expect(mockedFetch).toHaveBeenCalledTimes(4);
        expect(result.length).toEqual(0);
    });

    test('Requests return normally if resolved after backoff and backoff as function argument works', async () => {
        mockedFetch
        .mockImplementationOnce(() => {
            throw new Error('error123');
        })
        .mockImplementationOnce((url) => {
            return url; 
        });
        
        const reqHandler = new RequestHandler(1, 300, (err, nr) => {
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
            result = await reqHandler.get(async () => {
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
        .mockImplementationOnce((url) => {
            return new Promise((res, rej) => {
                setTimeout(() => {
                    res(url); 
                });
            });
        })
        .mockImplementationOnce(() => {
            throw new Error('error123');
        });

        const reqHandler = new RequestHandler(1, 20);
        let error;
        let result;
        try{
            result = await reqHandler.get(async () => {
                return await mockedFetch(`test_url`);
            });
            await reqHandler.get(async () => {
                return await mockedFetch(`test_url`);
            });
        } catch(e) {
            error = e;
        }
        expect(error).toBeTruthy();
        expect(error.message).toEqual('error123');
        expect(result).toEqual('test_url');
        expect(mockedFetch).toHaveBeenCalledTimes(5);
    });
});