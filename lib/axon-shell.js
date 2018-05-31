const readline = require('readline');
const fs       = require('fs');

const Axon = require('./axon');
const eywa = require('./eywa');
const log  = require('./log');

const __opt = process.env.HOME + '/.node-eywa.json';
const noop = function () { };
const ascii = /^[\x00-\x7F]+$/m;

let _singleton = null;

const vercmp = function (a, b)
{
   const split  = /(\d+)|/;
   const filter = function(x){ return !!x; };
   const map    = function(x){ let n= +x; return isNaN(n) ? x : n; };
   a = String(a).split(split).filter(filter).map(map);
   b = String(b).split(split).filter(filter).map(map);
   for (let i = 0; ; ++i)
   {
      if (void 0 === a[i]) return (void 0 === b[i] ? 0 : -1);
      if (void 0 === b[i]) return (void 0 === a[i] ? 0 : +1);
      if (a[i] === b[i]) continue;
      if ('string' === typeof a[i] && 'string' === typeof b[i])
      {
         return a[i].codePointAt(0) - b[i].codePointAt(0);
      }
      if ('string' === typeof a[i]) return +1;
      if ('string' === typeof b[i]) return -1;
      return a[i] - b[i];
   }
   return 0;
};

const AxonShell = module.exports = function (opts)
{
   if (_singleton) return _singleton;
   if (!(this instanceof AxonShell)) return new AxonShell(opts);
   if (!opts) opts = {};

   const isTTY = process.stdin.isTTY && process.stdin.isTTY;
   const IFS = (isTTY ? ' ' : (opts.ifs || ' \t'));
   if (!ascii.test(IFS)) throw new RangeError('invalid IFS');
   const IFSS = new RegExp('([' + IFS + '\\\'\\"\\\\])');
   const IFST = new RegExp('^[' + IFS + ']+$');

   const _split = function (str)
   {
      let arr = str.split(IFSS);
      let c = '', e = 0, i = -1, w = '';
      let res = [];
      while (1)
      {
         if (arr.length <= ++i)
         {
            if (w) res.push(w);
            break;
         }
         if ('' == arr[i]) continue;
         if (e)
         {
            w += arr[i];
            e = 0;
            continue;
         }
         if (IFST.test(arr[i]))
         {
            if (c) w += arr[i];
            else if (w)
            {
               res.push(w);
               w = '';
            }
         }
         else
         {
            switch (arr[i])
            {
               case ''   :        break;
               case '\\' : e = 1; break;
               case '\'' :
               case '\"' :
                  if (arr[i] === c)
                  {
                     res.push(w);
                     w = '';
                     c = '';
                  }
                  else if (w) w += arr[i];
                  else c = arr[i];
                  break;
               default :
                  w += arr[i];
                  break;
            }
         }
      }
      return res;
   };

   const _completer = function (line, cb)
   {
      let len = line.length;
      line = line.replace(/^\s+/, '');
      if (len !== line.length)
      {
         _shell.line = line;
         _shell._refreshLine();
         _shell._moveCursor(line.length - len);
      }
      let done = false;
      let complete = function (list)
      {
         if (done) return;
         done = true;
         if (!list) list = [];
         let hints = list.filter(function (w)
            { return 0 === w.indexOf(line) });
         cb(null, [hints, line]);
      };
      if (/\s+$/.test(line))
      {
         complete([]);
      }
      else if (-1 === line.indexOf('.'))
      {
         complete(_axon.info('hello'));
      }
      else if (0 === line.indexOf('.'))
      {
         let list = [];
         for (let i in _internal)
         {
            list.push('.' + i);
         }
         complete(list);
      }
      else
      {
         let to = line.substring(0, line.indexOf('.'))
         let ids = _axon.info('ids');
         for (let i = 0; i < ids.length; ++i)
         {
            if (ids[i] === to)
            {
               complete([]);
               return;
            }
         }
         let base = line.substring(0, line.lastIndexOf('.'));
         let err;
         try
         {
            err = _axon.send(base + '.', function (val)
            {
               if (val instanceof Array)
               {
                  for (let i = 0; i < val.length; ++i)
                  {
                     val[i] = base + val[i];
                  }
                  complete(val);
               }
               else complete([]);
            });
         }
         catch (ex) { err = ex; }
         if (err) complete([]);
      }
   };
   const _incoming = [];
   const _outgoing = [];
   let _axon = null;
   let _shell = null;

   const _init = function ()
   {
      _shell = readline.createInterface({
           input     : process.stdin
         , output    : process.stdout
         , completer : (isTTY ? _completer : null)
         , terminal  : isTTY
      });
      _shell
      .on('line', _online)
      .on('close', function ()
         {
            if (isTTY)
            {
               _shell.line = '.exit';
               _shell._refreshLine();
               process.stdout.write('\n');
               process.exit(0);
            }
         }
      );
   };

   const _internal =
   {
      help : function ()
      {
         return fs.readFileSync(__dirname + '/../README'
            , { encoding : 'utf8' });
      },
      list : function ()
      {
         return _axon.info('hello').sort(vercmp).join('\n');
      },
      read : function (max)
      {
         max <<= 0;
         if (0 >= max) max = +Infinity;
         let res = '';
         if (_incoming.length)
            while (_incoming.length && max--)
               res += _incoming.shift() + '\n';
         return res;
      },
      save : function ()
      {
         let data = JSON.stringify(opts, null, '   ');
         fs.writeFileSync(__opt, data
            , { encoding : 'utf8', mode : 0o600, flag : 'w' });
         return 'current options saved in \'' + __opt + '\'';
      },
      clear : function ()
      {
         process.nextTick(
            function ()
            {
               process.stdout.write('\x1b[1;1H\x1b[0J\r');
               _prompt();
            }
         );
      },
      exit : function (code)
      {
         process.exit(code & 0xFF);
      }
   };

   let _on = true;
   const _prompt = function (on)
   {
      if (!isTTY) return;
      if (void 0 !== on && _on !== on)
      {
         if (_on !== on) _beep();
         _on = on;
      }
      if (null === _shell) return;
      _shell.setPrompt(_axon.info('id')
         + (_incoming.length ? '+' + _incoming.length : '')
         + (_on ? '>' : '<') + ' ');
      _shell.prompt(true);
   };
   const _beep = function ()
   {
      if (isTTY) process.stdout.write('\x07');
   };
   const _online = function (line)
   {
      line = line.trim();
      if (!line) return _prompt();
      if (_shell.paused)
      {
         return _outgoing.push(line);
      }
      if ('?' === line) line = '.help';
      let args = _split(line);
      for (let i = 1; i < args.length; ++i)
      {
         args[i] = eywa.parse(args[i]);
      }
      if (args.length)
      {
         _shell.paused = true;
         _shell.pause();
         if (isTTY && 0 === args[0].indexOf('.'))
         {
            let cmd = _internal[args[0].substring(1)];
            let res;
            switch (typeof cmd)
            {
               case 'function' :
                  try { res = cmd.apply(null, args.slice(1)); }
                  catch (ex) { res = ex; }
                  if (void 0 === res) res = '';
                  break;
               case 'undefined' :
                  res = new Error('unknown command');
                  break;
               default :
                  res = cmd;
                  break;
            }
            if ('string' === typeof res) process.stdout.write(res);
            else process.stdout.write(log.colorize(res));
            _output();
         }
         else
         {
            let cb = function (res)
            {
               _output(args[0], null, [res]);
            };
            args.push(cb);
            let err;
            try { err = _axon.send.apply(_axon, args); }
            catch (ex) { err = ex; }
            if (err) cb(err);
         }
      }
   };
   const _output = function (from, path, args)
   {
      if (null === _shell && args)
      {
         args.unshift(from + ':' + path);
         log.apply(log, args);
         return;
      }
      let str = '';
      if (args)
      {
         if (isTTY && 1 === args.length && 'string' === typeof args[0]
            && /\.(version|help)$/.test(from))
         {
            str = '\x1B[32m' + args[0] + '\x1B[0m';
         }
         else
         {
            str = from + ':' + (path ? path.join('.') : '');
            for (let i = 0; i < args.length; ++i)
            {
               str += '\t' + (isTTY
                  ? log.colorize(args[i])
                  : eywa.stringify(args[i]));
            }
         }
      }
      if (_shell.paused) process.stdout.write(str + '\n');
      else
      {
         if (_shell.line && 1000 > _incoming.length)
         {
            _incoming.push(str);
            _beep();
         }
         else process.stdout.write('\n' + str + '\n');
      }
      _shell.paused = false;
      _shell.resume();
      if (_outgoing.length)
      {
         _online(_outgoing.shift());
         return;
      }
      else if (!isTTY) _axon.close(true);
      _prompt();
   };
   const _debug = function (name, err)
   {
      if (opts.test && err instanceof Error) throw err;
      if (opts.debug) _output('', [name], (err ? [err] : []));
   };
   const _check_dup = function ()
   {
      let hello = _axon.info('hello').sort();
      let i = 0;
      while (i < hello.length - 1)
      {
         if (hello[i] === hello[++i])
         {
            let ids = _axon.info('ids');
            for (let j = 0; j < ids.length; ++j)
            {
               if (ids[j] === hello[i])
               {
                  log.emerg(new Error(
                     'exit by duplicate `' + ids[j] + '`'));
               }
            }
         }
      }
   };
   const _onopen = function ()
   {
      _debug('onopen');
      if (null === _shell) _init();
      _prompt(true);
      _check_dup();
   };
   const _onhello = function ()
   {
      _debug('onhello');
      _check_dup();
   };
   const _onidle = function (err)
   {
      _debug('onidle', err);
      _prompt(false);
   };
   const _onclose = function (err)
   {
      _debug('onclose', err);
      _prompt(false);
   };
   const _onerror = function (err)
   {
      _debug('onerror', err);
   };

   this.open = function (url)
   {
      if (null !== _axon) throw new Error('shell: already opened');
      if (void 0 === url) url = '//anon@';
      if ('string' !== typeof url) throw new TypeError('invalid url');
      if (-1 === url.indexOf('//') && -1 !== url.indexOf('@'))
      {
         url = '//' + url;
      }
      _axon = new Axon(opts, _output);
      _axon.onidle  = _onidle;
      _axon.onopen  = _onopen;
      _axon.onclose = _onclose;
      _axon.onhello = _onhello;
      _axon.onerror = _onerror;
      _axon.open(url);
      opts[''] = url;
   };

   const _close = this.close = function ()
   {
      if (null === _axon) return;
      _axon.onidle  = null;
      _axon.onopen  = null;
      _axon.onclose = null;
      _axon.onerror = null;
      _axon.close(true);
      _axon = null;
   };

   Object.freeze(this);
};
