# polite-call

[![NPM](https://nodei.co/npm/polite-call.png)](https://nodei.co/npm/polite-call/)

[![Install Size](https://packagephobia.now.sh/badge?p=polite-call)](https://packagephobia.now.sh/result?p=polite-call)

Simple, light-weight module to implement rate limiting and a backoff function at the same time. Mostly intended for REST API calls,
however it can wrap any function you like to limit its call rate and backoff on error.

## Installation

    $ npm install polite-call

## Usage

Initializing the CallHandler with a rate limit of 100 calls per second:

```js
import CallHandler from 'polite-call';

const handler = new CallHandler(100, 1000);
```

Now this object can be used to wrap any function you want the rate limit to apply to.

### Before:
```js
await fetch('https://www.exampleurl.com/');
```

### After:
```js
await handler.call(() => fetch('https://www.exampleurl.com/'));
```

All functions called through the object will obey the rate limit together and will only throw an error after 3 retries. 

## How it works

 - When the rate limit is exceeded, the excess function calls simply await their turn to be executed in first-in-first-out fashion. This generally leads requests to be executed in bursts each period.
 - If an error is encountered, all calls through the object are halted until a retry is successful. If the backoff function terminates and the error gets rethrown, the whole queue is flushed and every call returns with the same error.

## The CallHandler object

Constructor parameters:

| parameter       | type    | description                                      |
| --------------- | ------- | ------------------------------------------------ |
| `rateLim`       | number  | The maximum number of function calls allowed in the specified period.        |
| `periodLength`  | number  | The length of the period in ms, in which the rate limit applies. Set to 0 to disable rate limiting.          |
| `backoff`       | (optional)<br>function<br>number  | Either:<br> - A number denoting the amount of retries using the default backoff function before error gets passed to caller. Set to 0 to turn off backoff functionality.<br> - A function(error: Error, attemptNr: number) which takes the error and amount of previous retries and returns time in ms to wait before the next retry, or undefined to stop retrying and pass error to the caller.                           |

## Backoff Function

Example implementing an exponential backoff which starts with 100ms and stops (rethrows the error upward) after 3 retries:

```js
import CallHandler from 'polite-call';

const handler = new CallHandler(1, 0, (err, attemptNr) => {
    if (attemptNr > 3) {
        return 100 * (2 ** attemptNr);
    } else {
        return undefined;
    }
});
```

Incidentally, this is the default backoff function implementation, whereas it generally starts with the specified period length if it's nonzero.