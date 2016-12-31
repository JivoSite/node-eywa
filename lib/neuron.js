const crypto = process.binding('crypto');

const tcp  = require('./tcp');
const uri  = require('./uri');
const ares = require('./ares');
const eywa = require('./eywa');
const log  = require('./log').get('neuron');


const empty = Buffer.allocUnsafe(0);

const _midbuf = Buffer.from('000000');
const genmid = function ()
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

const valid = function (id)
{// private must be one and first, public unlimited
   if (null === id) return 0;
   let end = id.length - 1;
   if (0x0A !== id[end] && 0x09 !== id[end]) return 0;
   id[end] = 0x09;
   let n = 0, c = 0, p = false;
   for (let i = 0; i < id.length; ++i)
   {
      switch (id[i])
      {
         case 0x5F : // _
            if (0 !== n++) continue;
            if (0 === c && !p) p = true;
            else return 0;
            continue;
         case 0x09 : // \t
            if (0 === n) return 0;
            n = 0;
            if (p) --c; else ++c;
            continue;
         default : // 0               9               A
            if (0x30 > id[i] || (0x39 < id[i] && 0x41 > id[i])
               || (0x5A < id[i] && 0x61 > id[i]) || 0x7A < id[i])
            {//         Z               a                z
               return 0;
            }
            ++n;
            continue;
      }
   }
   return c;
};

const Neuron = module.exports = function (opts)
{
   if (!(this instanceof Neuron)) return new Neuron(opts);

   if (null === opts || 'object' !== typeof opts)
   {
      throw new TypeError('invalid options');
   }

   const _bind    = [];
   const _servers = [];
   const _clients = [];
   const _agents  = [];
   const _guests  = {};
   const _uidstr  = '_' + crypto.randomBytes(8).toString('hex') + '\n';
   const _uidbuf  = Buffer.from(_uidstr);
   let   _wdt = null;
   let   _wd = eywa.testWDopts(opts.net);
   let   _ares_tick = -1;
   let   _uri = null;
   let   _pubbuf = empty;
   let   _synbuf = empty;

   let _opts_bind = opts.bind;
   if ('string' === typeof _opts_bind)
   {
      _opts_bind = [_opts_bind];
   }
   if (!(_opts_bind instanceof Array))
   {
      throw new TypeError('invalid bind option');
   }
   for (let i = 0; i < _opts_bind.length; ++i)
   {
      let url = uri.parse(_opts_bind[i]
         , uri.AUTHORITY | uri.QUERY
         , { scheme : 'ion' });
      if (null === url)
      {
         throw new Error('invalid bind uri «' + _opts_bind[i] + '»');
      }

      if (!url.host) url.host = '::';
      else if ('localhost' === url.host) url.host = '::1';
      else if (!ares.isIP(url.host))
      {
         throw new Error('invalid bind host «' + _opts_bind[i] + '»');
      }

      if (!(0 < url.port && 0xFFFF >= url.port))
      {
         throw new RangeError('invalid port «' + _opts_bind[i] + '»');
      }
      _bind.push(url);
   }

   const _reset = function ()
   {
      log.info('reset');
      for (let i = 0; i < _clients.length; ++i)
      {
         _clients[i].close();
      }
      for (let i in _guests)
      {
         _guests[i].write(502);
         _guests[i].close();
      }
   };

   const _remote = function ()
   {
      let rmt;
      if (0 < _pubbuf.length)
      {
         rmt =Buffer.allocUnsafe(_uidbuf.length + _pubbuf.length);
         _uidbuf.copy(rmt, 0, 0, _uidbuf.length);
         _pubbuf.copy(rmt, _uidbuf.length, 0, _pubbuf.length);
         rmt[_uidbuf.length - 1] = 0x09;
         rmt[rmt.length - 1] = 0x0A;
      }
      else rmt = _uidbuf;
      return rmt;
   };

   const _local = function ()
   {
      let loc;
      if (0 < _synbuf.length)
      {
         loc = Buffer.allocUnsafe(_pubbuf.length + _synbuf.length);
         _pubbuf.copy(loc, 0, 0, _pubbuf.length);
         _synbuf.copy(loc, _pubbuf.length, 0, _synbuf.length);
         loc[_pubbuf.length - 1] = 0x09;
         loc[loc.length - 1] = 0x0A;
      }
      else loc = _pubbuf;
      return loc;
   };

   const _anonce = function (syn)
   {
      if (!_refresh(syn)) return;
      log.info('anonce', (syn ? 'GLOBAL' : 'LOCAL'));
      if (!syn)
      {
         let rmt = _remote();
         for (let i = 0; i < _agents.length; ++i)
         {
            if (_agents[i]._loop) continue;
            _agents[i].write(rmt);
         }
      }
      let loc = _local();
      if (0 === loc.length) return;
      for (let i = 0; i < _clients.length; ++i)
      {
         let id = _clients[i]._id;
         if (null !== id && 1 < id.length)
         {
            if (0x5F !== id[0]) _clients[i].write(loc);
         }
      }
   };

   const _refresh = function (syn)
   {
      /*********************************
       _locbuf = _pubbuf + _synbuf
       _rmtbuf = _uid + _pubbuf
       *********************************/
      let id, buf, off = 0,len = 0, po, old = (syn ? _synbuf : _pubbuf);
      for (let i = 0; i < _clients.length; ++i)
      {
         id = _clients[i]._id;
         if (null !== id && 1 < id.length)
         {
            if (syn && 0x5F === id[0])
            {
               po = 0;
               while (0x09 !== id[po++]) ;
               len += id.length - po;
            }
            else if (!syn && 0x5F !== id[0]) len += id.length;
         }
      }
      if (0 !== len)
      {
         buf = Buffer.allocUnsafe(len);
         for (let i = 0; i < _clients.length; ++i)
         {
            id = _clients[i]._id;
            if (null !== id && 1 < id.length)
            {
               if (syn && 0x5F === id[0])
               {
                  po = 0;
                  while (0x09 !== id[po++]) ;
                  id.copy(buf, off, po, id.length);
                  off += id.length - po;
               }
               else if (!syn && 0x5F !== id[0])
               {
                  id.copy(buf, off, 0, id.length);
                  off += id.length;
               }
            }
         }
         buf[buf.length - 1] = 0x0A;
      }
      else buf = empty;
      if (old.length !== buf.length)
      {
         if (syn) _synbuf = buf; else _pubbuf = buf;
         return true;
      }
      for (let i = 0; i < buf.length; ++i)
      {
         if (old[i] !== buf[i])
         {
            if (syn) _synbuf = buf; else _pubbuf = buf;
            return true;
         }
      }
      return false;
   };

   const _watchdog = function ()
   {
      if (0 < _ares_tick)
      {
         if (_wd.dns < ++_ares_tick)
         {
            _ares_tick = 0;
            _ares();
         }
      }
      let sock;
      for (let i = 0; i < _clients.length; ++i)
      {
         sock = _clients[i];
         if (_wd.kill < ++sock._tick)
         {
            log.debug('timeout', sock);
            sock.close(true);
         }
      }
      for (let i in _guests)
      {
         sock = _guests[i];
         if (_wd.kill < ++sock._tick)
         {
            log.debug('timeout', sock);
            sock.write(504);
            sock.close();
         }
      }
      for (let i = 0; i < _agents.length; ++i)
      {
         sock = _agents[i];
         if (sock._loop) continue;
         switch (++sock._tick)
         {
            case _wd.ping :
               sock.write(eywa.PING);
               if (opts.verbose) log.debug('ping', sock);
               break;
            case _wd.kill :
               _agents[i] = _connect(sock._ip, sock);
               break;
            default : break;
         }
      }
   };

   const _onagtcomplete = function ()
   {
      let protocol = _uri.scheme;
      this.protocol = protocol;
      if (protocol !== this.protocol)
      {
         log.err('oncomplete', this
            , new Error('protocol not supported'));
         _agtclose(this);
      }
      else
      {
         log.info('oncomplete', this);
         this.nodelay = true;
         this.write(_remote());
         this._tick = 0;
      }
   };

   const _onagtclose = function (err)
   {
      this._tick = _wd.ping;
      log.info('onclose', this, err);
      _anonce();
   };

   const _onagtmessage = function (msg)
   {
      switch (msg[0])
      {
         case 0x3F : // ? query
         case 0x21 : // ! confirm
         case 0x2E : // . query no confirm
            log.debug('onmessage', this);
            _send(this, msg, true); //send only self
            break;
         case 0x0A : // LF
         case 0x09 : // TAB
            this._tick = 0;
            if (opts.verbose) log.debug('onpong', this);
            break;
         case 0x5F : // _ private hello
         default : // public hello
            break;
      }
   };

   const _agtclose = function (agt)
   {
      if (!agt) return;
      agt.onerror    = null;
      agt.oncomplete = null;
      agt.onwrite    = null;
      agt.onclose    = null;
      agt.onmessage  = null;
      log.info('close', agt);
      agt.close(true);
      if (agt._loop) _reset();
   };

   const _connect = function (ip, old)
   {
      _agtclose(old);
      let agt = new tcp(tcp.CLIENT);
      agt._ip = ip;
      agt.onerror    = _onerror;
      agt.onwrite    = _onwrite;
      agt.oncomplete = _onagtcomplete;
      agt.onclose    = _onagtclose;
      agt.onmessage  = _onagtmessage;
      log.info('connect', ip, agt.connect(ip, _uri.port));
      return agt;
   };

   const _ares = function (err, ips)
   {
      if (0 > _ares_tick) return;
      _ares_tick = 0;
      if (err) return log.warning('ares', err);
      if (ips)
      {
         ips.sort();
         let i = -1;
         while (true)
         {
            ++i;
            if (ips.length <= i)
            {
               if (_agents.length <= i) break;
               else
               {
                  _agtclose(_agents[i]);
                  _agents.splice(i--, 1);
               }
            }
            else if (ips[i] === ips[i + 1])
            {
               ips.splice(i--, 1);
            }
            else if (_agents.length <= i)
            {
               _agents[i] = _connect(ips[i], _agents[i]);
            }
            else
            {
               if (_agents[i]._ip !== ips[i])
               {
                  _agents[i] = _connect(ips[i], _agents[i]);
               }
            }
         }
      }
      else if (ares.isIP(_uri.host))
      {
         _ares(null, [_uri.host]);
         _ares_tick = -1;
      }
      else
      {
         err = ares.getaddrinfo(_uri.host, ares.UNSPEC + tcp.CLIENT
            , null, _ares);
         if (err) log.warning('ares', err);
      }
   };

   const _send = function (own, msg, self)
   {
      let err, off = 0, lim = msg.length - 2;
      while (0x09 !== msg[off] && lim > off) ++off;
      ++off;
      if (lim < off || 3 > off)
      {
         log.warning('send', new Error('bad message'));
         return 0;
      }
      if (0x5F === msg[off]) // private to
      {
         for (let i = 0, j = off; i < _uidbuf.length && j < msg.length;
            ++i, ++j)
         {
            if (0x0A === _uidbuf[i] && (0x09 === msg[j]
                  || 0x0A === msg[j] || 0x2E === msg[j]))
            {// self to
               let mi = msg.toString('utf8', 1, off - 1);
               if (mi in _guests)
               {
                  _guests[mi]._busy = false;
                  err = _guests[mi].write(msg);
                  log.debug('send', _guests[mi], err || 'OK');
                  if (!_guests[mi]._alive) _guests[mi].close();
                  return 1;
               }
               else
               {
                  log.warning('send', new Error('guest not found'));
                  return 0;
               }
            }
            else if (_uidbuf[i] !== msg[j]) break;
         }
      }
      let cli, id;
      for (let i = 0; i < _clients.length; ++i)
      {
         cli = _clients[i];
         id = cli._id;
         if (null === id || (own === cli
            || (true === self && 0x5F === id[0]))) continue;
         for (let ci = 0; ci < id.length; ++ci)
         {
            for (let mi = off; mi < msg.length; ++mi, ++ci)
            {
               if (0x09 === id[ci] && (0x09 === msg[mi]
                  || 0x0A === msg[mi] || 0x2E === msg[mi]))
               {
                  let err = cli.write(msg);
                  if (!err)
                  {
                     log.debug('send', cli);
                     return 1;
                  }
                  else log.warning('send', cli, err);
                  break;
               }
               else if (msg[mi] !== id[ci])
               {
                  while (id.length > ci && 0x09 !== id[ci]) ++ci;
                  break;
               }
            }
         }
      }
      return 0;
   };

   const _onerror = function (err)
   {
      log.warning('onerror', this, err);
   };

   const _onwrite = function (bytes)
   {
      if (opts.verbose) log.debug('onwrite', this, bytes);
   };

   const _oncliclose = function (err)
   {
      log.debug('onclose', this, err);
      this.onerror    = null;
      this.onwrite    = null;
      this.onclose    = null;
      this.onmessage  = null;
      for (let i = 0; i < _clients.length; ++i)
      {
         if (this === _clients[i])
         {
            _clients.splice(i, 1);
            let vd = valid(this._id);
            if (-1 > vd) _anonce(true);
            else if (0 < vd) _anonce();
            this._id = null;
            return;
         }
      }
   };

   const _ongstclose = function (err)
   {
      log.debug('onclose', this, err);
      this.onerror    = null;
      this.onwrite    = null;
      this.onclose    = null;
      this.onmessage  = null;
      for (let i in _guests)
      {
         if (this === _guests[i])
         {
            delete _guests[i];
            return;
         }
      }
   };

   const _isloop = function (uid, cli)
   {
      for (let i = 0; i < _uidbuf.length && i < uid.length; ++i)
      {
         if (0x0A === _uidbuf[i]
            && (0x09 === uid[i] || 0x0A === uid[i]))
         {
            for (let j = 0; j < _agents.length; ++j)
            {
               if (cli.peerPort === _agents[j].sockPort)
               {
                  log.info('loop', _agents[j]);
                  _agents[j]._loop = true;
                  _agents[j].close(true);
                  return true;
               }
            }
            break;
         }
         if (_uidbuf[i] !== uid[i]) break;
      }
      return false;
   };

   const _onclimessage = function (msg)
   {
      this._tick = 0;
      switch (msg[0])
      {
         case 0x3F : // ? query
         case 0x21 : // ! confirm
         case 0x2E : // . query no confirm
            log.debug('onmessage', this);
            _send(this, msg);
            break;
         case 0x0A : // LF
         case 0x09 : // TAB
            if (opts.verbose) log.debug('onping', this);
            this.write(msg);
            break;
         case 0x5F : // _ private hello
            if (_isloop(msg, this)) break;
         default : // hello
            let vd = valid(msg);
            if (0 === vd) // invalid
            {
               log.warning('onhello', this, 'invalid');
               return this.close();
            }
            else if (-1 === vd) // one private
            {
               log.debug('onhello', this, 'private');
               vd = valid(this._id);
               this._id = msg;
               if (-1 > vd) _anonce(true);
               else if (0 < vd) _anonce();
            }
            else // public or one private and public
            {
               log.debug('onhello', this, 'public');
               this._id = msg;
               if (-1 > vd) _anonce(true);
               else if (0 < vd) _anonce();
            }
            break;
      }
   };

   const _ongstmessage = function (msg)
   {
      if (this._busy)
      {
         this.write(429);
         this.close();
         return;
      }
      this._busy = true;
      try
      {
         if (null === msg || 'object' !== typeof msg) throw 500;
         if (msg.upgrade) throw 501;
         if (1 !== msg.major && 1 !== msg.minor) throw 426;
         this._alive = !!msg.alive;
         let post;
         switch (msg.method)
         {
            case 'GET'     : post = false; break;
            case 'POST'    : post = true;  break;
            case 'OPTIONS' : throw 0;
            default        : throw 405;
         }
         let url = uri.parse(msg.url
            , (post ? uri.PATH : uri.PATH | uri.QUERY));
         if (!url || !url.path) throw 400;
         let path = url.path;
         while ('' === path[0]) path.shift();
         if (0 === path.length)
         {
            log.debug('onmessage', this, '/');
            let loc = _local();
            let buf = Buffer.allocUnsafe(3 + loc.length);
            loc.copy(buf, 3, 0, loc.length);
            buf[0] = 0x21;
            buf[1] = 0x09;
            buf[2] = 0x09;
            this.write(buf);
            this._busy = false;
            return;
         }
         path = path.join('.');
         if (!eywa.ispath(path)) throw 404;
         let head = '?' + this._mid + '\t' + path + '\t' + _uidstr;
         let body = null;
         if (post && msg.body instanceof Buffer)
         {
            body = msg.body.toString().replace(/\n/g, '\t');
         }
         else if (url.args)
         {
            for (let i = 0; i < url.args.length; ++i)
            {
               url.args[i] = url.args[i]
                  .replace(/\t/g, '\\t').replace(/\n/g, '\\n');
            }
            body = url.args.join('\t');
         }
         let buf;
         if (null !== body)
         {
            head = head.substring(0, head.length - 1) + '\t';
            buf = Buffer.from(head + body + '\n');
         }
         else buf = Buffer.from(head);
         log.debug('onmessage', this);
         this._tick = 0;
         _send(null, buf);
      }
      catch (ex)
      {
         if (0 === ex) log.info('onmessage', this, 'OPTIONS');
         else log.warning('onmessage', this, ex);
         this.write('number' === typeof ex ? ex : 400);
         this.close();
      }
   };

   const _onconnection = function (cli)
   {
      log.debug('onconnection', cli);
      cli.nodelay = true;
      cli._tick   = _wd.ping;
      cli.onerror = _onerror;
      cli.onwrite = _onwrite;
      if ('http' === cli.protocol)
      {
         let _mid = genmid();
         if (_mid in _guests)
         {
            _guests[_mid].write(503);
            _guests[_mid].close();
         }
         cli.onclose   = _ongstclose;
         cli.onmessage = _ongstmessage;
         cli._mid      = _mid;
         _guests[_mid] = cli;
      }
      else
      {
         cli.onclose   = _oncliclose;
         cli.onmessage = _onclimessage;
         cli._id       = null;
         _clients.push(cli);
      }
   };

   this.open = function (url)
   {
      if (1 < arguments.length) throw new Error('too many arguments');
      if (void 0 === url || '' === url) url = '//';
      if ('string' !== typeof url)
      {
         throw new TypeError('invalid url');
      }
      if (null !== _wdt) throw new Error('already opened');
      _uri = uri.parse(url, uri.HOST | uri.PORT, { scheme : 'ion' });
      if (null === _uri) throw new Error('invalid url');
      if (!/^ions?$/.test(_uri.scheme)) throw new Error('invalid scheme');
      if (!_uri.host) _uri.host = '';
      if (!(0 < _uri.port && 0xFFFF >= _uri.port)) throw new RangeError('invalid uri');
      for (let i = 0; i < _bind.length; ++i)
      {
         let srv = new tcp(tcp.SERVER);
         srv.protocol = _bind[i].scheme;
         if (_bind[i].scheme !== srv.protocol)
         {
            srv.close(true);
            throw new Error('protocol «' + _bind[i].scheme + '» not supported');
         }
         srv.onerror = _onerror;
         srv.onclose = function (err)
         {
            log.debug('onclose', this, null === err ? 'SOCK' : err);
            for (let i = 0; i < _servers.length; ++i)
            {
               if (this === _servers[i])
               {
                  _servers.splice(i, 1);
                  return;
               }
            }
         };
         srv.onconnection = _onconnection;
         let err = srv.bind(_bind[i].host, _bind[i].port);
         if (err)
         {
            srv.close(true);
            while (_servers.length) _servers.pop().close(true);
            throw err;
         }
         log.info('bind', srv);
         if (_bind[i].query && _bind[i].query.backlog)
         {
            srv._backlog = _bind[i].query.backlog;
         }
         err = srv.listen(srv._backlog);
         if (err)
         {
            srv.close(true);
            while (_servers.length) _servers.pop().close(true);
            throw err;
         }
         log.info('listen', srv, srv._backlog);
         _servers.push(srv);
      }
      if (opts.test)
      {
         while (_servers.length) _servers.pop().close(true);
         return;
      }
      _ares_tick = 0;
      _ares();
      _wdt = setInterval(_watchdog, eywa.TICK);
   };

   this.close = function (force)
   {
      if (null === _wdt) return;
      clearInterval(_wdt);
      _wdt = null;
      _ares_tick = -1;
      _uri  = null;
      while (_servers.length) _servers.pop().close(true);
      while (_agents.length)  _agents.pop().close(true);
      for (let i = 0; i < _guests.length; ++i)
      {
         _guests[i].close(true);
      }
      for (let i = 0; i < _clients.length; ++i)
      {
         _clients[i].close(true);
      }
   };

   this.info = function (key)
   {
      ;
   };

   Object.freeze(this);
};
