>co的主要思想是利用把每个yield后面的值转成一个Promise对象，然后给该Promise对应注册fulfilled和rejected两个回调，在这两个回调里会执行next函数，进行下一步迭代，也就是执行下一个yield，从而不断地向前驱动迭代器，直到执行完毕或者出错。

co的好处：
```
	var content = yield readSomethingAsync();
	console.log(content);
```
即使readSomethingAsync是异步完成的，但是当执行到console.log(content);这里的时候可以保证content的内容是我们想要的。而不需要通过在一大堆回调里对content进行赋值。这就是通过同步的方式写异步代码。
co的大致执行流程
![这里写图片描述](http://img.blog.csdn.net/20170716171736768?watermark/2/text/aHR0cDovL2Jsb2cuY3Nkbi5uZXQvVEhFQU5BUktI/font/5a6L5L2T/fontsize/400/fill/I0JBQkFCMA==/dissolve/70/gravity/SouthEast)
```

/**
 * slice() reference.
 */

var slice = Array.prototype.slice;

/**
 * Expose `co`.
 */

module.exports = co['default'] = co.co = co;

/**
 * Wrap the given generator `fn` into a
 * function that returns a promise.
 * This is a separate function so that
 * every `co()` call doesn't create a new,
 * unnecessary closure.
 *
 * @param {GeneratorFunction} fn
 * @return {Function}
 * @api public
 */
// 包裹一个generatorFunction，后面执行
co.wrap = function (fn) {
  createPromise.__generatorFunction__ = fn;
  return createPromise;
  function createPromise() {
    // 执行generatorFunction，返回一个iterator供co使用
    return co.call(this, fn.apply(this, arguments));
  }
};

/**
 * Execute the generator function or a generator
 * and return a promise.
 *
 * @param {Function} fn
 * @return {Promise}
 * @api public
 */
// 参数可以是生成器函数或者迭代器
function co(gen) {
  var ctx = this;
  // 获取传给生成器函数的参数，如果gen是迭代器则该参数没用，见下面的gen.apply(ctx, args);
  var args = slice.call(arguments, 1)

  // we wrap everything in a promise to avoid promise chaining,
  // which leads to memory leak errors.
  // see https://github.com/tj/co/issues/180
  return new Promise(function(resolve, reject) {
    /* 
      gen是函数说明是一个生成器函数，此时，执行生成器函数返回一个迭代器
      如果gen不是一个函数，则一般情况下是一个迭代器，否则直接resovle该值返回
    */
    if (typeof gen === 'function') gen = gen.apply(ctx, args);
    if (!gen || typeof gen.next !== 'function') return resolve(gen);
    // 迭代器开始自动执行
    onFulfilled();

    /**
     * @param {Mixed} res
     * @return {Promise}
     * @api private
     */

    function onFulfilled(res) {
      var ret;
      try {
        // 执行到yield语句，返回yield语句右边的值，传入的res是上一个yield右边对应的Promise决议的值
        ret = gen.next(res);
      } catch (e) {
        // 出错则reject
        return reject(e);
      }
      // 已yield返回值为参数，执行next，进行下一次的迭代
      next(ret);
    }

    /**
     * @param {Error} err
     * @return {Promise}
     * @api private
     */

    function onRejected(err) {
      var ret;
      try {
        // 抛出异常，如果当前的yield在try中，则该异常由生成器内部捕获处理，否则由onRejected函数处理
        ret = gen.throw(err);
      } catch (e) {
        return reject(e);
      }
      next(ret);
    }

    /**
     * Get the next value in the generator,
     * return a promise.
     *
     * @param {Object} ret
     * @return {Promise}
     * @api private
     */

    function next(ret) {
      // 迭代器执行完毕则resolve
      if (ret.done) return resolve(ret.value);
      // 把yield返回的值，也就是迭代器返回的值转成Promise
      var value = toPromise.call(ctx, ret.value);
      /*
        如果返回的值是一个Promise，或者能被转成Promise，则注册后续的回调，等待value(a Promise)的决议，
        resolve或者reject。这里是co库的重点，每一次yield后，返回的值都会被转成一个Promise，然后等待该Promise
        决议，执行注册的回调，在回调中继续调用next执行下一次迭代，也就是执行下一个yield，循环这个过程，直到迭代器结束。
          
      */
      if (value && isPromise(value)) return value.then(onFulfilled, onRejected);
      // 不能转成Promise则抛出异常
      return onRejected(new TypeError('You may only yield a function, promise, generator, array, or object, '
        + 'but the following object was passed: "' + String(ret.value) + '"'));
    }
  });
}

/**
 * Convert a `yield`ed value into a promise.
 *
 * @param {Mixed} obj
 * @return {Promise}
 * @api private
 */
// 把obj转成Promise
function toPromise(obj) {
  if (!obj) return obj;
  if (isPromise(obj)) return obj;
  if (isGeneratorFunction(obj) || isGenerator(obj)) return co.call(this, obj);
  if ('function' == typeof obj) return thunkToPromise.call(this, obj);
  if (Array.isArray(obj)) return arrayToPromise.call(this, obj);
  if (isObject(obj)) return objectToPromise.call(this, obj);
  return obj;
}

/**
 * Convert a thunk to a promise.
 *
 * @param {Function}
 * @return {Promise}
 * @api private
 */
/*
  把thunk函数转成Promise，thunk函数具体可参考thunkify库，
  实际是一个偏函数，最后一个参数需要一个回调,如下代码所示。
*/
function thunkToPromise(fn) {
  var ctx = this;
  return new Promise(function (resolve, reject) {
    /*
      fn是一个偏函数，里面包裹这一个异步函数，此时他还需要最后一个参数，也就是回调函数。
      如果不调用回调则该Promise无法决议。执行fn的时候，一般是一个异步的操作，比如readFile读取文件，
      然后读取完毕后会执行回调，在回调了执行该Promise的resolve或者reject
    */
    fn.call(ctx, function (err, res) {
      if (err) return reject(err);
      if (arguments.length > 2) res = slice.call(arguments, 1);
      resolve(res);
    });
  });
}

/**
 * Convert an array of "yieldables" to a promise.
 * Uses `Promise.all()` internally.
 *
 * @param {Array} obj
 * @return {Promise}
 * @api private
 */
// 数组转成Promise
function arrayToPromise(obj) {
  // 把数组里的每个元素都转成Promise，Promise.all等待该数组中的所有的Promise决议
  return Promise.all(obj.map(toPromise, this));
}

/**
 * Convert an object of "yieldables" to a promise.
 * Uses `Promise.all()` internally.
 *
 * @param {Object} obj
 * @return {Promise}
 * @api private
 */

function objectToPromise(obj){
  var results = new obj.constructor();
  var keys = Object.keys(obj);
  var promises = [];
   // 把对象中的每个值转成一个Promise
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    // 把对象的值转成Promise，如果不能转，则直接记录该值
    var promise = toPromise.call(this, obj[key]);
    if (promise && isPromise(promise)) defer(promise, key);
    else results[key] = obj[key];
  }
  // 等待所有Promise的决议，然后返回results
  return Promise.all(promises).then(function () {
    return results;
  });
  // 往promises数组中加promise
  function defer(promise, key) {
    // predefine the key in the result
    results[key] = undefined;
    promises.push(promise.then(function (res) {
      results[key] = res;
    }));
  }
}

/**
 * Check if `obj` is a promise.
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api private
 */

function isPromise(obj) {
  return 'function' == typeof obj.then;
}

/**
 * Check if `obj` is a generator.
 *
 * @param {Mixed} obj
 * @return {Boolean}
 * @api private
 */

function isGenerator(obj) {
  return 'function' == typeof obj.next && 'function' == typeof obj.throw;
}

/**
 * Check if `obj` is a generator function.
 *
 * @param {Mixed} obj
 * @return {Boolean}
 * @api private
 */
function isGeneratorFunction(obj) {
  var constructor = obj.constructor;
  if (!constructor) return false;
  if ('GeneratorFunction' === constructor.name || 'GeneratorFunction' === constructor.displayName) return true;
  return isGenerator(constructor.prototype);
}

/**
 * Check for plain object.
 *
 * @param {Mixed} val
 * @return {Boolean}
 * @api private
 */

function isObject(val) {
  return Object == val.constructor;
}

```
