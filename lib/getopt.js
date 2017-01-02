const SOP = '[^-=\x00-\x20\x7F-\uFFFF]';
const LOP = '[A-Za-z_][A-Za-z_0-9]+';
const ISSHT = new RegExp(SOP + '+');
const ISOPT = new RegExp('^' + LOP + '(\\.' + LOP + ')*$');
const ISKEY = new RegExp('^(?:(-' + SOP + '+)|(-(?:-' + LOP + ')+))'
   + '(?:[=](.*))?$');

const normalize = function (path)
{
   if ('string' !== typeof path)
   {
      throw new TypeError('path must be string');
   }
   if ('~' === path[0])
   {
      switch (path[1])
      {
         case (void 0) : return process.env.HOME;
         case '/' : return process.env.HOME + path.substring(1);
         case '+' : return process.env.PWD + '/' + path.substring(2);
         case '-' : return process.env.OLDPWD + '/' + path.substring(2);
         default : return '/home/' + path.substring(1);
      }
   }

   return path;
};

const invalid = function (val, leaf)
{
   if (null !== val && 'object' === typeof val)
   {
      if (leaf) return true;
      if (val instanceof Array)
      {
         for (let i = 0; i < val.length; ++i)
         {
            if (invalid(val[i], true)) return true;
         }
      }
      else return true;
   }
   return false;
};

module.exports = function (opts, conf, args)
{
   if ('object' !== typeof conf)
   {
      throw new TypeError('getopt: argument #0 must be object');
   }
   if ('object' !== typeof opts)
   {
      throw new TypeError('getopt: argument #1 must be object');
   }
   if (null !== args && !(args instanceof Array))
   {
      throw new TypeError('getopt: argument #2 must be array');
   }

   if (!opts) opts = {};
   if (!conf) conf = {};
   if (!args) args = [];

   let sopt = {}, eopt = {}, ropt = {};

   const option = function (src, key, val, cvt)
   {
      src += ': ';
      if (invalid(val))
      {
         throw new TypeError(src + 'invalid value');
      }
      if (cvt && void 0 !== val)
      {
         switch (val)
         {
            case      'true' : val = true;       break;
            case     'false' : val = false;      break;
            case      'null' : val = null;       break;
            case  'Infinity' : val = Infinity;   break;
            case '+Infinity' : val = +Infinity;  break;
            case '-Infinity' : val = -Infinity;  break;
            default :
               let num = +val;
               if (!isNaN(num)) val = num;
               break;
         }
      }
      if (void 0 === key)
      {
         args.push(val);
         return;
      }
      if (!(key in opts))
      {
         throw new Error(src + 'invalid option');
      }
      if (ropt[key])
      {
         if ('=' === ropt[key][0] && void 0 === val)
         {
            throw new TypeError(src + 'must have value');
         }
      }
      else if (cvt && void 0 !== val)
      {
         args.push(val);
         return;
      }
      else if (void 0 !== val)
      {
         throw new TypeError(src + 'can\'t have value');
      }
      if (void 0 === val) val = true;
      let n = conf;
      let p = key.split('.');
      while (true)
      {
         let k = p.shift();
         if (0 === p.length)
         {
            if (n[k] instanceof Array)
            {
               if ('-' === val) n[k] = [];
               else if (val instanceof Array)
               {
                  for (let i = 0; i < val.length; ++i)
                  {
                     if ('-' === val) n[k] = [];
                     else n[k].push(val[i])
                  }
               }
               else n[k].push(val);
            }
            else
            {
               if (null !== n[k] && 'object' === typeof n[k])
               {
                  throw new TypeError(src + 'child conflict');
               }
               n[k] = val;
            }
            break;
         }
         else
         {
            if (k in n)
            {
               if (null === n[k]
                  || 'object' !== typeof n[k]
                  || n[k] instanceof Array)
               {
                  throw new TypeError(src + 'parent conflict');
               }
            }
            else
            {
               n[k] = {};
            }
            n = n[k];
         }
      }
   };

   const jsonOption = function (v, k)
   {
      if (null === v || 'object' !== typeof v)
      {
         option('`' + k + '`', k || void 0, v);
      }
      else if (v instanceof Array)
      {
         for (let j = 0; j < v.length; ++j)
         {
            option('`' + k + '`', k, v[j]);
         }
      }
      else
      {
         for (let f in v)
         {
            jsonOption(v[f], (k ? k + '.' : '') + f);
         }
      }
   };

   for (let o in opts)
   {
      if (!ISOPT.test(o))
      {
         throw new Error('OPTIONS:' + o + ' invalid name');
      }
      let opt = opts[o] || [];
      if ('string' === typeof opt)
      {
         opt = [opt];
      }
      if (!(opt instanceof Array))
      {
         throw new TypeError('OPTIONS:' + o + ' invalid value');
      }
      if (opt[0]) // short options
      {
         if ('string' !== typeof opt[0])
         {
            throw new TypeError('OPTIONS:' + o + ' invalid short');
         }
         if (!ISSHT.test(opt[0]))
         {
            throw new RangeError('OPTIONS:' + o + ' invalid short');
         }
         for (let i = 0; i < opt[0].length; ++i)
         {
            let c = opt[0][i];
            if (c in sopt)
            {
               throw new Error('OPTIONS:-' + c + ' duplicate short');
            }
            sopt[c] = o;
         }
      }
      if (opt[1]) // environment
      {
         if ('string' !== typeof opt[1])
         {
            throw new TypeError('OPTIONS:' + o + ' invalid env');
         }
         if (opt[1] in eopt)
         {
            throw new Error('OPTIONS:' + opt[1] + ' duplicate env');
         }
         eopt[opt[1]] = o;
      }
      if (opt[2]) // required
      {
         if ('string' !== typeof opt[2])
         {
            throw new TypeError('OPTIONS:' + o + ' invalid required');
         }
         ropt[o] = opt[2];
      }
      if (3 < opt.length) // defults
      {
         option('OPTIONS:' + o, o, opt[3]);
      }
   }

   for (let i = 3; i < arguments.length; ++i)
   {
      let path = normalize(arguments[i]);
      if ('string' !== typeof path)
      {
         throw new TypeError('getopt: argument #' + i
            + ' must be string');
      }
      let cfg;
      try
      {
         cfg = require('fs').readFileSync(path, { encoding : 'utf8' });
      }
      catch (ex) { continue; }
      if (!/[^\s]/gm.test(cfg)) continue;
      try { cfg = JSON.parse(cfg); }
      catch (ex)
      {
         throw new SyntaxError('invalid json config `' + path + '`');
      }
      jsonOption(cfg, '');
   }

   for (let e in eopt)
   {
      if (e in process.env)
      {
         option(e, eopt[i], process.env[e], true);
      }
   }

   let nopt = false;
   for (let i = 2; i < process.argv.length; ++i)
   {
      if ('--' === process.argv[i])
      {
         nopt = true;
         continue;
      }
      if (nopt)
      {
         option('', void 0, process.argv[i], true);
         continue;
      }

      let key = void 0, val = void 0, src = '';
      let r = ISKEY.exec(process.argv[i]);
      if (null !== r)
      {
         if (void 0 !== r[1])
         {
            let s = r[1].substring(1);
            for (let j = 0; j < s.length; ++j)
            {
               key = sopt[s[j]];
               if ('string' !== typeof key)
               {
                  throw new TypeError('-' + s[j] + ': invalid option');
               }
               key = key.replace(/-/g, '.');
               if (j < (s.length - 1))
               {
                  option('-' + s[j], key);
               }
               else src = '-' + s[j];
            }
         }
         else if (void 0 !== r[2])
         {
            key = r[2].substring(2).replace(/-/g, '.');
            src = r[2];
         }
         if (void 0 !== r[3])
         {
            val = r[3];
         }
         else if ((i < (process.argv.length - 1))
            && !ISKEY.test(process.argv[i + 1])
            && '--' !== process.argv[i + 1]
            && ropt[key])
         {
            val = process.argv[++i];
         }
      }
      else if ('-' === process.argv[i][0])
      {
         throw new Error(process.argv[i] + ': invalid option');
      }
      else
      {
         val = process.argv[i];
      }

      option(src, key, val, true);
   }
};
