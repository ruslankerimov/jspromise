/**
 * Vow
 *
 * Copyright (c) 2012 Filatov Dmitry (dfilatov@yandex-team.ru)
 * Dual licensed under the MIT and GPL licenses:
 * http://www.opensource.org/licenses/mit-license.php
 * http://www.gnu.org/licenses/gpl.html
 *
 * @version 0.1.2
 */

(function(global) {

var nextTick = typeof process === 'object'? // nodejs
        process.nextTick :
        global.setImmediate? // ie10
            global.setImmediate :
            global.postMessage? // modern browsers
                (function() {
                    var fns = [],
                        msg = '__promise' + +new Date;

                    global.addEventListener(
                        'message',
                        function(e) {
                            if(e.source === global && e.data === msg) {
                                e.stopPropagation();
                                var callFns = fns, i = 0, len = fns.length;
                                fns = [];
                                while(i < len) {
                                    callFns[i++]();
                                }
                            }
                        },
                        true);

                    return function(fn) {
                        fns.push(fn) === 1 && global.postMessage(msg, '*');
                    };
                })() :
                function(fn) { // old browsers
                    setTimeout(fn, 0);
                },
    isFunction = function(obj) {
        return typeof obj === 'function';
    };

var Promise = function(val) {
    this._res = val;

    this._isFulfilled = typeof val !== 'undefined';
    this._isRejected = false;

    this._fulfilledCallbacks = [];
    this._rejectedCallbacks = [];
};

Promise.prototype = {
    valueOf : function() {
        return this._res;
    },

    isFulfilled : function() {
        return this._isFulfilled;
    },

    isRejected : function() {
        return this._isRejected;
    },

    isResolved : function() {
        return this._isFulfilled || this._isRejected;
    },

    fulfill : function(val) {
        if(this.isResolved()) {
            return;
        }

        this._isFulfilled = true;
        this._res = val;

        this._callCallbacks(this._fulfilledCallbacks);
        this._fulfilledCallbacks = this._rejectedCallbacks = null;
    },

    reject : function(error) {
        if(this.isResolved()) {
            return;
        }

        this._isRejected = true;
        this._res = error;

        this._callCallbacks(this._rejectedCallbacks);
        this._fulfilledCallbacks = this._rejectedCallbacks = null;
    },

    then : function(onFulfilled, onRejected) {
        var promise = new Promise(),
            cb;

        if(!this._isRejected) {
            cb = { promise : promise, fn : onFulfilled };
            this._isFulfilled?
                this._callCallbacks([cb]) :
                this._fulfilledCallbacks.push(cb);
        }

        if(!this._isFulfilled) {
            cb = { promise : promise, fn : onRejected };
            this._isRejected?
                this._callCallbacks([cb]) :
                this._rejectedCallbacks.push(cb);
        }

        return promise;
    },

    fail : function(onRejected) {
        return this.then(null, onRejected);
    },

    spread : function(onFulfilled, onRejected) {
        return this.then(
            function(val) {
                return onFulfilled.apply(this, val);
            },
            onRejected);
    },

    _callCallbacks : function(callbacks) {
        if(!callbacks.length) {
            return;
        }

        var arg = this._res,
            isFulfilled = this.isFulfilled();

        nextTick(function() {
            var i = 0, len = callbacks.length, cb;
            while(i < len) {
                var promise = (cb = callbacks[i++]).promise,
                    fn = cb.fn;

                if(isFunction(fn)) {
                    var res;
                    try {
                        res = fn(arg);
                    }
                    catch(e) {
                        promise.reject(e);
                        continue;
                    }

                    Vow.isPromise(res)?
                        (function(promise) {
                            res.then(
                                function(val) {
                                    promise.fulfill(val);
                                },
                                function(error) {
                                    promise.reject(error);
                                })
                        })(promise) :
                        promise.fulfill(res);
                }
                else {
                    isFulfilled?
                        promise.fulfill(arg) :
                        promise.reject(arg);
                }
            }
        });
    }
};

var Vow = {
    promise : function(val) {
        return new Promise(val);
    },

    isPromise : function(obj) {
        return obj && isFunction(obj.then);
    },

    fulfill : function(val) {
        return this.when(val, null, function(error) {
            return error;
        });
    },

    reject : function(error) {
        return this.when(error, function(val) {
            var promise = new Promise();
            promise.reject(val);
            return promise;
        });
    },

    when : function(obj, onFulfilled, onRejected) {
        return (this.isPromise(obj)? obj : new Promise(obj)).then(onFulfilled, onRejected);
    },

    forEach : function(promises, onFulfilled, onRejected) {
        var i = 0, len = promises.length;
        while(i < len) {
            this.when(promises[i++], onFulfilled, onRejected);
        }
    },

    all : function(promises) {
        var resPromise = new Promise(),
            i = promises.length;

        if(i) {
            var onFulfilled = function() {
                    if(!--i) {
                        var res = [],
                            promise;
                        while(promise = promises[i++]) {
                            res.push(promise.valueOf());
                        }
                        resPromise.fulfill(res);
                    }
                },
                onRejected = function(error) {
                    resPromise.reject(error);
                };

            this.forEach(promises, onFulfilled, onRejected);
        }
        else {
            resPromise.fulfill([]);
        }

        return resPromise;
    },

    allResolved : function(promises) {
        var resPromise = new Promise(),
            i = promises.length;

        if(i) {
            var onProgress = function() {
                    if(!--i) {
                        resPromise.fulfill(promises);
                    }
                };

            this.forEach(promises, onProgress, onProgress);
        }
        else {
            resPromise.fulfill(promises);
        }

        return resPromise;
    },

    any : function(promises) {
        var resPromise = new Promise(),
            len = promises.length;

        if(len) {
            var i = 0, error,
                onFulfilled = function(val) {
                    resPromise.fulfill(val);
                },
                onRejected = function(_error) {
                    i || (error = _error);
                    if(++i === len) {
                        resPromise.reject(error);
                    }
                };

            this.forEach(promises, onFulfilled, onRejected);
        }
        else {
            resPromise.reject(Error());
        }

        return resPromise;
    },

    timeout : function(origPromise, timeout) {
        var resPromise = new Promise(),
            timer = setTimeout(function() {
                resPromise.reject(Error('timed out'));
            }, timeout);

        origPromise.then(
            function(res) {
                clearTimeout(timer);
                resPromise.fulfill(res);
            },
            function(error) {
                clearTimeout(timer);
                resPromise.reject(error);
            });

        return resPromise;
    }
};

if(typeof exports === 'object') {
    module.exports = Vow;
}
else if(typeof define === 'function') {
    define(function(require, exports, module) {
        module.exports = Vow;
    });
}
else {
    global.Vow = Vow;
}

})(this);