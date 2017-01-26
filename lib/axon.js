const eywa = require('./eywa');
const uri  = require('./uri');
const TCP  = require('./tcp');
const ares = require('./ares');

const noop = function () { };

const BREAK = new Error('BREAK');
delete BREAK.stack;
Object.freeze(BREAK);

const random = function (lim)
{
   let val = (Math.random() * lim) << 0;

   return (val < lim ? val : lim - 1);
};

const _midbuf = Buffer.from('00000000');

const mid = function ()
{
   for (let i = _midbuf.length - 1; i >= 0 ; --i)
   {
      if (0x39 === _midbuf[i]) _midbuf[i] = 0x30;
      else
      {
         ++_midbuf[i];
         break;
      }
   }

   return _midbuf.toString();
};

const ls = function (obs, arg)
{
   let arr = [];
   let large = '+' === arg;

   let _depth = function (obs, prf)
   {
      if (null !== obs && 'object' === typeof obs)
      {
         for (let i in obs)
         {
            _depth(obs[i], prf + '.' + i);
         }
      }
      else if (large)
      {
         if ('function' === typeof obs)
         {
            arr.push(prf + '(' + obs.length + ')');
         }
         else
         {
            arr.push(prf + '=' + eywa.stringify(obs));
         }
      }
      else arr.push(prf);
   };
   _depth(obs, '');

   return arr;
};

const eVal = function (obs, path, args, from)
{
   if (from && 'function' === typeof obs)
   {
      try { return obs(from, path, args); }
      catch (ex) { return ex; }
   }
   if (0 === path.length)
   {
      if ('function' === typeof obs)
      {
         try { return obs.apply(obs, args); }
         catch (ex) { return ex; }
      }
      else if (0 === args.length) return obs;
      else if (null === obs || 'object' !== typeof obs)
      {
         return new EvalError('too many arguments');
      }
      else return new EvalError('illegal operation on a directory');
   }
   if ('' === path[0])
   {
      while ('' === path[0] && 1 < path.length) path.shift();
      if ('' === path[0])
      {
         if (null !== obs && 'object' === typeof obs)
         {
            return ls(obs, args[0]);
         }
         else return new EvalError('not a directory');
      }
   }
   let d, key = path[0];
   if (null !== obs && 'object' === typeof obs)
   {
      if (1 === path.length)
      {
         d = Object.getOwnPropertyDescriptor(obs, key);
         if (void 0 !== d && true === d.enumerable)
         {
            if ('function' === typeof obs[key])
            {
               try { return obs[key].apply(obs, args); }
               catch (ex) { return ex; }
            }
            else if (1 === args.length && 'object' !== typeof obs[key])
            {
               if (true !== d.writable && 'function' !== typeof d.set)
               {
                  return new Error('permission denied');
               }
               if (void 0 === obs[key]
                  || typeof obs[key] === typeof args[0])
               {
                  try { obs[key] = args[0]; return obs[key]; }
                  catch (ex) { return ex; }
               }
               else return new EvalError('operation not permitted');
            }
            else
            {
               path.shift();
               return eVal(obs[key], path, args);
            }
        }
        else return new EvalError('no such file or directory');
      }
      else
      {
         path.shift();
         return eVal(obs[key], path, args);
      }
   }
   else return new EvalError('not a directory');
};

const Axon = module.exports = function (opts, obs)
{
   if (!(this instanceof Axon)) return new Axon(opts, obs);
   if (!opts) opts = {};

   const _this = this, _root = ('function' === typeof obs);
   let _uri = null, _cli = null, _wdt = null, _net,
      _hello = null,_stack = {}, _idle = 0, _rto = 0;

   const _id = function (all)
   {
      if (all)
      {
         if (null !== _uri && _uri.userinfo)
         {
            return _uri.userinfo.slice();
         }
         return [];
      }
      else if (null !== _uri && _uri.userinfo && _uri.userinfo[0])
      {
         return _uri.userinfo[0];
      }
      return '';
   };

   const _emit = function (name, e)
   {
      if ('function' !== typeof _this[name]) return;
      try { _this[name](e); }
      catch (ex) { if ('onerror' !== name) _emit('onerror', ex); }
   };

   const _watchdog = function ()
   {
      ++_idle;
      if (_idle === 0) return _connect();
      else if (_idle === _net.ping) _write(eywa.PING);
      else if (_idle === _net.kill) return _close(true);
      let n;
      for (let i in _stack)
      {
         n = _stack[i];
         if (++n.idle === _net.send)
         {
            if (++n.count >= _net.retry)
            {
               try { n.cb(BREAK); }
               catch (ex) { _onerror(ex); }
               delete _stack[i];
               continue;
            }
            n.idle = 0;
            if (_ishello(n.to)) _write(n.buf);
         }
      }
   };

   const _onclose = function (err)
   {
      _hello = null;
      if (0 === _rto) _rto = 1;
      else if (eywa.MRTO > _rto) _rto <<= 1;
      _idle = -_rto;
      _cli.onerror    = null;
      _cli.oncomplete = null;
      _cli.onwrite    = null;
      _cli.onclose    = null;
      _cli.onmessage  = null;
      _cli = null;
      if (null === _wdt) _emit('onclose', err);
      else _emit('onidle', err);
      if (opts.test) _close(true);
   };

   const _onerror = function (err)
   {
      _emit('onerror', err);
   };

   const _connect = function (err, ips)
   {
      if (!err)
      {
         if (ips && _uri)
         {
            _cli = new TCP(TCP.CLIENT);
            _cli.onerror    = _onerror;
            _cli.oncomplete = _oncomplete;
            _cli.onwrite    = _onwrite;
            _cli.onclose    = _onclose;
            _cli.onmessage  = _onmessage;
            let ip = ips[random(ips.length)];
            err = _cli.connect(ip, _uri.port);
         }
         else if (ares.isIP(_uri.host))
         {
            _connect(null, [_uri.host]);
         }
         else
         {
            err = ares.getaddrinfo(
               _uri.host, ares.UNSPEC | TCP.CLIENT, null, _connect);
         }
      }
      if (err) _emit('onerror', err);
   };

   const _oncomplete = function ()
   {
      let protocol = _uri.scheme;
      this.protocol = protocol;
      if (protocol !== this.protocol)
      {
         _emit('onerror', new Error('protocol not supported'));
         _close(true);
      }
      else
      {
         if (opts.test) return _close(true);
         _rto = 0;
         this.nodelay = true;
         _write(_uri.userinfo.join('\t'));
         _idle = 0;
      }
   };

   const _onwrite = function (bytes)
   {
   };

   const _parse = function (msg)
   {
      msg = msg.toString('utf8', 1 , msg.length - 1);
      msg = msg.split('\t');
      for (let i = 0; i < msg.length; ++i)
      {
         msg[i] = eywa.parse(msg[i]);
      }
      return msg;
   };

   const _onmessage = function (msg)
   {
      let args, arg, mi, cmd, from, path, to, id, res;
      switch (msg[0])
      {
         case 0x3F : // ? query
            _idle = 0;
         case 0x2E : // . no confirm
            args = _parse(msg);
            if (3 > args.length)
            {
               _emit('onerror', new RangeError('invalid message'));
               break;
            }
            mi = args.shift();
            cmd = args.shift();
            from = args.shift();
            path = String(cmd).split('.');
            to = path.shift();
            id;
            for (let i = 0; i < _uri.userinfo.length; ++i)
            {
               if (_uri.userinfo[i] === to)
               {
                  id = to;
                  break;
               }
            }
            if (!id)
            {
               _emit('onerror', new Error('invalid destination'));
               break;
            }
            res = eVal(obs, path, args, _root ? from : void 0);
            if (0x2E !== msg[0])
            {
               _write(['!' + mi, from
                  , eywa.stringify(res)].join('\t'));
            }
            break;
         case 0x21 : // ! confirm
            args = _parse(msg);
            if (3 > args.length)
            {
               _emit('onerror', new RangeError('invalid confirm'));
               break;
            }
            mi = args.shift();
            if ('' === mi)
            {
               _emit('onerror', new Error('empty confirm id'));
               break;
            }
            if (!(mi in _stack))
            {
               _emit('onerror', new Error('missing confirm'));
               break;
            }
            to = args.shift();
            arg = args.shift();
            id;
            for (let i = 0; i < _uri.userinfo.length; ++i)
            {
               if (_uri.userinfo[i] === to)
               {
                  id = to;
                  break;
               }
            }
            if (!id)
            {
               _emit('onerror', new Error('invalid destination'));
               break;
            }
            try { _stack[mi].cb(arg); }
            catch (ex) { _emit('onerror', ex); }
            delete _stack[mi];
            break;
         case 0x0A : // \n
         case 0x09 : // \t
            _idle = 0; //pong
            break;
         default : // hello
            msg = msg.toString('utf8', 0, msg.length - 1);
            arg = null === _hello;
            _hello = msg.split('\t');
            if (arg) _emit('onopen');
            else _emit('onhello');
            break;
      }
   };

   const _ishello = function (to)
   {
      if (null === _hello) return false;
      for (let i = 0; i < _hello.length; ++i)
      {
         if (_hello[i] === to || 0 === to.indexOf(_hello[i] + '.'))
         {
            return true;
         }
      }
      return false;
   };

   const _write = function (msg)
   {
      let err;
      if (null === _cli) err = new Error('not connected');
      else err = _cli.write(msg);
      if (err) _emit('onerror', err);
      return err;
   };

   const _open = function (url)
   {
      if (null !== _wdt)           throw new Error('already opened');
      if (0 === arguments.length)  throw new Error('uri required');
      if ('string' !== typeof url) throw new TypeError('invalid uri');
      _uri = uri.parse(url, uri.AUTHORITY, { scheme : 'ion' });
      if (!_uri)          throw new Error('invalid uri');
      if (!/^ions?$/.test(_uri.scheme))
                          throw new Error('unsupported scheme');
      if (!_uri.userinfo) throw new Error('userinfo required in uri');
      for (let i = 0; i < _uri.userinfo.length; ++i)
      {
         if (!eywa.isid(_uri.userinfo[i]))
         {
            _uri = null;
            throw new Error('invalid id `' + _uri.userinfo[i] + '`');
         }
      }
      _net = eywa.testopts(opts.net);
      _wdt = setInterval(_watchdog, eywa.TICK);
      _idle = _net.ping;
      _connect();
   };

   const _close = function (force)
   {
      if (null === _wdt) return;
      clearInterval(_wdt);
      _wdt = null;
      _uri = null;
      _stack = {};
      _hello = null;
      _idle = 0;
      _rto = 0;
      if (null !== _cli) _cli.close(force);
   };

   const _send = function (to)
   {
      if (null === _wdt)
      {
         _onerror(new Error('first use the axon.open'));
         return;
      }
      let self = false, cb = null, id = _id(), err, path, mi;
      let args = Array.prototype.slice.call(arguments);
      if ('function' === typeof args[args.length - 1])
      {
         cb = args.pop();
      }
      if ('string' !== typeof to || '' === to || !eywa.ispath(to))
      {
         err = new Error('invalid destination');
         if (null === cb) return err;
         else
         {
            try { cb(err); }
            catch (ex) { _onerror(ex); }
            return;
         }
      }
      if ('.' === to[0]) self = true;
      else
      {
         for (let i = 0; i < _uri.userinfo.length; ++i)
         {
            if (to === _uri.userinfo[i]
               || 0 === to.indexOf(_uri.userinfo[i] + '.'))
            {
               self = true;
               break;
            }
         }
      }
      if (self)
      {
         args.shift();
         path = to.split('.');
         path.shift();
         if (null === cb)
         {
            try { return eVal(obs, path, args, _root ? id : void 0); }
            catch (ex) { return ex; }
         }
         else
         {
            try
            {
               process.nextTick(function ()
               {
                  try { cb(eVal(obs, path, args, _root ? id : void 0)); }
                  catch (ex) { _onerror(ex); }
               });
               return;
            }
            catch (ex) { return ex; }
         }
      }
      if (null === _wdt)
      {
         err = new Error('not open');
         if (null === cb) return err;
         else
         {
            try { cb(err); }
            catch (ex) { _onerror(ex); }
            return;
         }
      }
      for (let i = 1; i < args.length; ++i)
      {
         args[i] = eywa.stringify(args[i]);
      }
      mi = mid();
      args.splice(1, 0, id);
      args.unshift((null === cb ? '.' : '?') + mi);
      args = Buffer.from(args.join('\t') + '\n');
      if (0 < _net.length && args.length > _net.length)
      {
         err = new RangeError('message too large');
         if (null === cb) return err;
         else
         {
            try { cb(err); }
            catch (ex) { _onerror(ex); }
            return;
         }
      }
      if (null !== cb)
      {
         _stack[mi] = { to : to, buf : args,
            count : 0, idle : 0, cb : cb };
      }
      if (_ishello(to))
      {
         err = _write(args);
         if (null === cb) return err;
         return;
      }
      if (null === cb) return new Error('destination not exists');
   };

   const _info = function ()
   {
      let info = [];

      for (let i = 0; i < arguments.length; ++i)
      {
         switch (arguments[i])
         {
            case 'id'    : info.push(_id()); break;
            case 'ids'   : info.push(_id(true)); break;
            case 'hello' :
               info.push(_hello ? _hello.slice() : null);
               break;
            case 'state' :
               info.push((!_wdt << 1)
                  | (!_wdt ^ (_cli && -1 !== _cli.fd)) << 0);
               break;
            default : info.push(void 0); break;
         }
      }

      return (1 < arguments.length ? info : info[0]);
   };

   Object.defineProperties(this, {
      BREAK : { value : BREAK, enumerable : true },
      open  : { value : _open, enumerable : true },
      send  : { value : _send, enumerable : true },
      info  : { value : _info, enumerable : true },
      close : { value : _close, enumerable : true }
   });
};
