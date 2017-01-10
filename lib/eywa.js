const PERR = /^((?:Eval|Range|Reference|Syntax|Type|URI)?Error): (.*)$/;
const PBUF = /^Buffer:(hex|base64)? (.*)$/;

const ISID   = /^[a-z][_a-z0-9]*$/i;
const ISPATH = /^[a-z][_a-z0-9]*(\.[_a-z0-9]*)*$/i;

exports.PING = Buffer.from('\n');

const CIRCULAR = exports.CIRCULAR = {};
Object.defineProperty(CIRCULAR, 'toString', {
   value : function () { return '[Circular]'; },
   writable : false, enumerable : false, configurable : false
});
Object.freeze(CIRCULAR);

exports.TICK = 1000;
exports.MRTO = 8;
const TTL = ((60 * 60 * 1000) / exports.TICK) << 0;
const WD =
{
   ping   : 3,
   send   : 3,
   kill   : 5,
   retry  : 3,
   dns    : 20,
   length : 0
};

const _testopts = function (opts)
{
   for (let i in opts)
   {
      if (!(i in WD))
      {
         throw new Error('unused watchdog option `' + i + '`');
      }
      opts[i] = +opts[i];
      if (!(isFinite(opts[i])))
      {
         throw new TypeError('invalid watchdog option `' + i + '`');
      }
      if (0 > opts[i])
      {
         throw new RangeError('invalid watchdog option `' + i + '`');
      }
      let min = 1, max = 60;
      switch (i)
      {
         case 'ping' :
            min = 1;
            max = 60;
            break;
         case 'send' :
            min = 1;
            max = 600;
            break;
         case 'kill' :
            min = opts.ping + 1;
            max = opts.ping * 2;
            break;
         case 'retry' :
            min = 0;
            max = (TTL / opts.send) << 0;
            break;
         case 'dns' :
            min = 1;
            max = TTL;
            break;
         case 'length' :
            min = 0;
            max = 0xFFFFF; // 1MB - 1B
            break;
      }
      if (min > opts[i] || max < opts[i])
      {
         throw new RangeError('invalid watchdog option `'
            + i + '` should be ' + min + ' <=> ' + max);
      }
   }
};

exports.testopts = function (opts, key, val)
{
   if (null === opts || void 0 === opts) opts = {};
   if ('object' !== typeof opts)
   {
      throw new TypeError('invalid watchdog options');
   }
   let res = {};

   for (let i in WD)
   {
      res[i] = WD[i];
   }
   for (let i in opts)
   {
      if (void 0 !== opts[i] && null !== opts[i])
      {
         res[i] = opts[i];
      }
   }
   if (1 !== arguments.length)
   {
      res[key] = val;
   }
   _testopts(res);

   return res;
};

exports.isid = function (str)
{
   return ISID.test(str);
};

exports.ispath = function (str)
{
   return ISPATH.test(str);
};

exports.stringify = function (obj)
{
   switch (obj)
   {
      case        '' : return '""';
      case      null : return 'null';
      case    void 0 : return 'undefined';
      case  Infinity : return 'Infinity';
      case -Infinity : return '-Infinity';
   }
   if ('number' === typeof obj && isNaN(obj)) return 'NaN';
   switch (obj.constructor)
   {
      case Buffer : return 'Buffer: ' + obj.toString('base64');
      case Date   : return 'Date: ' + obj.toUTCString();
      case Error          :
      case EvalError      :
      case RangeError     :
      case ReferenceError :
      case SyntaxError    :
      case TypeError      :
      case URIError       :
         return obj.name + ': '
            + JSON.stringify(String(obj.message)).slice(1, -1);
   }
   try { return JSON.stringify(obj); }
   catch (ex) { return 'Circular'; }
};

exports.parse = function (str)
{
   if ('string' !== typeof str) return str;
   switch (str)
   {
      case          '' :
      case 'undefined' : return;
      case       'NaN' : return NaN;
      case  'Infinity' :
      case '+Infinity' : return Infinity;
      case '-Infinity' : return -Infinity;
      case  'Circular' : return CIRCULAR;
   }
   if (/^[A-Z]$/.test(str[0]))
   {
      let r;
      if (0 === str.indexOf('Date: '))
      {
         return new Date(str.substring(6));
      }
      else if (null !== (r = PBUF.exec(str)))
      {
         return Buffer.from(r[2], r[1] || 'base64');
      }
      else if (null !== (r = PERR.exec(str)))
      {
         let err;
         let msg;

         try { msg = JSON.parse('"' + r[2] + '"'); }
         catch (ex) { msg = r[2]; }
         try { err = new global[r[1]](msg); }
         catch (ex) { err = new Error(msg); }
         err.stack = r[1] + ': ' + msg + '\n    at remote axon';

         return err;
      }
      return str;
   }
   try { return JSON.parse(str); }
   catch (ex) { return str; }
};

Object.freeze(exports);
