const cares     = process.binding('cares_wrap');
const Socket    = process.binding('tcp_wrap').TCP;
const CReq      = process.binding('tcp_wrap').TCPConnectWrap;
const SReq      = process.binding('stream_wrap').ShutdownWrap;
const WReq      = process.binding('stream_wrap').WriteWrap;
const errno     = require('./errno');
const protocols = require('./protocols');

const BACKLOG = 511; // default backlog

const isPort = function (port)
{
   return 0 < port && 0xFFFF >= port;
};

const emit = function (tcp, name, e)
{
   if (!tcp._owner) return;
   if ('function' !== typeof tcp._owner[name]) return;
   tcp._owner[name](e);
};

const destroy = function (tcp, err)
{
   if ('_owner' in tcp)
   {
      emit(tcp, 'onclose', err);
      delete tcp._owner;
   }
   if (-1 !== tcp.fd)
   {
      tcp.close();
   }
   if ('_protocol' in tcp) delete tcp._protocol;
   if ('_parser' in tcp)
   {
      delete tcp._parser.onmessage;
      tcp._parser.destroy();
      delete tcp._parser;
   }
   if ('onread' in tcp) delete tcp.onread;
   if ('_type' in tcp)  delete tcp._type;
   if ('_sa' in tcp)    delete tcp._sa;
   if ('_sp' in tcp)    delete tcp._sp;
   if ('_pa' in tcp)    delete tcp._pa;
   if ('_pp' in tcp)    delete tcp._pp;

   return err;
};

const ref = function (tcp, on)
{
   if (1 < arguments.length)
   {
      if (on) tcp.ref();
      else tcp.unref();
   }
   else return tcp.hasRef();
};

const nodelay = function (tcp, on)
{
   let code = tcp.setNoDelay(!!on);
   if (errno.SUCCESS !== code) emit(tcp, 'onerror', errno.geterr(code));
};

const keepalive = function (tcp, sec)
{
   sec <<= 0;
   let code = tcp.setKeepAlive((0 < sec ? 1 : 0), sec);
   if (errno.SUCCESS !== code) emit(tcp, 'onerror', errno.geterr(code));
};

const afterconnect = function (tcp)
{
   let code;

   tcp.onread = onread;
   code = tcp.readStart();
   if (errno.SUCCESS !== code) return destroy(tcp, errno.geterr(code));

   let sn = {};
   code = tcp.getsockname(sn);
   if (errno.SUCCESS !== code) return destroy(tcp, errno.geterr(code));
   else
   {
      tcp._sa = sn.address;
      tcp._sp = sn.port;
   }

   let pn = {};
   code = tcp.getpeername(pn);
   if (errno.SUCCESS !== code) return destroy(tcp, errno.geterr(code));
   else
   {
      tcp._pa = pn.address;
      tcp._pp = pn.port;
   }

   return null;
};

const protocol = function (tcp, protocol)
{
   if (!tcp._owner)
   {
      return;
   }
   if (null === protocol)
   {
      if ('_protocol' in tcp) delete tcp._protocol;
      if ('_parser' in tcp)
      {
         delete tcp._parser.onmessage;
         tcp._parser.destroy();
         delete tcp._parser;
      }
   }
   else if (protocol in protocols && tcp._protocol !== protocol)
   {
      if ('_parser' in tcp)
      {
         delete tcp._parser.onmessage;
         tcp._parser.destroy();
      }
      tcp._parser = protocols[protocol](tcp._type);
      tcp._parser.onmessage = function (msg)
      {
         emit(tcp, 'onmessage', msg);
      };
      tcp._protocol = protocol;
   }
};

const onread = function (len, buf)
{
   if (0 === len) return;
   if (0 > len)
   {
      if (errno.EOF === len) destroy(this, void 0);
      else destroy(this, errno.geterr(len));

      return;
   }

   let n, off = 0;
   if ('_parser' in this)
   {
      try { n = this._parser.parse(buf, off, len); }
      catch (ex) { return destroy(this, ex); }
      if (n < len)
      {
         buf = buf.slice(n, len);
         let tcp = this;
         process.nextTick(function ()
         {
            if ('function' === typeof tcp.onread)
            {
               tcp.onread(buf.length, buf);
            }
         });
      }
   }
   else emit(this, 'onmessage', buf.slice(0, len));
};

const bind = function (tcp, address, port)
{
   if (!tcp._owner)                 return errno.geterr('EPIPE');
   if (-1 !== tcp.fd)               return errno.geterr('EISCONN');
   if (!isPort(port))               return errno.geterr('EINVAL');
   if ('string' !== typeof address) return errno.geterr('EINVAL');
   let bn;
   switch (cares.isIP(address))
   {
      case 4 : bn = 'bind';  break;
      case 6 : bn = 'bind6'; break;
      default : return errno.geterr('EINVAL');
   }

   let code = tcp[bn](address, port);
   if (errno.SUCCESS !== code) return errno.geterr(code);

   let sn = {};
   code = tcp.getsockname(sn);
   if (errno.SUCCESS !== code) return errno.geterr(code);
   else
   {
      tcp._sa = sn.address;
      tcp._sp = sn.port;
   }

   return null;
};

const onconnection = function (status, tcp)
{
   if (null === tcp) return emit(this, 'onerror', errno.geterr(status));
   if ('_parser' in this && this._protocol in protocols)
   {
      tcp._protocol = this._protocol;
      tcp._parser   = protocols[this._protocol](TCP.CLIENT);
      tcp._parser.onmessage = function (msg)
      {
         emit(tcp, 'onmessage', msg);
      };
   }
   emit(this, 'onconnection', new TCP(tcp));
};

const listen = function (tcp, backlog)
{
   if (!tcp._owner) return errno.geterr('EPIPE');
   if (void 0 === backlog) backlog = BACKLOG;
   else backlog <<= 0;

   let code = tcp.listen(backlog);

   if (errno.SUCCESS !== code) return errno.geterr(code);
   tcp.onconnection = onconnection;

   return null;
};

const onconnect = function (status, tcp, req)
{
   if (errno.SUCCESS !== status) destroy(tcp, errno.geterr(status));
   else if (null === afterconnect(tcp))
   {
      emit(tcp, 'oncomplete');
   }
};

const connect = function (tcp, address, port)
{
   if (!tcp._owner)   return errno.geterr('EPIPE');
   if (-1 !== tcp.fd) return errno.geterr('EISCONN');
   if (!isPort(port))    return errno.geterr('EINVAL');
   let cn;
   if ('string' !== typeof address)
   {
      return errno.geterr('EINVAL');
   }
   switch (cares.isIP(address))
   {
      case 4 : cn = 'connect';  break;
      case 6 : cn = 'connect6'; break;
      default : return errno.geterr('EINVAL');
   }

   let req = new CReq();
   req.oncomplete = onconnect;

   let code = tcp[cn](req, address, port);
   if (errno.SUCCESS !== code)
   {
      return destroy(tcp, errno.geterr(code));
   }

   return null;
};

const onshutdown = function (status, tcp, req)
{
   if (errno.SUCCESS !== status) destroy(tcp, errno.geterr(status));
   else destroy(tcp, null);
};

const close = function (tcp, force)
{
   if (-1 === tcp.fd || true === force)
   {
      return destroy(tcp, null);
   }

   let req = new SReq();
   req.oncomplete = onshutdown;

   let code = tcp.shutdown(req);
   if (errno.SUCCESS !== code)
   {
      return destroy(tcp, errno.geterr(code));
   }

   return null;
};

const onwrite = function (status, tcp, req, err)
{
   if (errno.SUCCESS !== status) destroy(tcp, errno.geterr(status));
   else if (req.emit) emit(tcp, 'onwrite', req.bytes);
};

const write = function (tcp, msg)
{
   if (-1 === tcp.fd) return errno.geterr('ENOTCONN');
   if ('_parser' in tcp)
   {
      try
      {
         msg = tcp._parser.serialize(msg, tcp._type);
      }
      catch (ex) { return ex; }
   }

   let code, req = new WReq();
   req.oncomplete = onwrite;
   req.emit = true;

   if ('string' === typeof msg)
   {
      code = tcp.writeUtf8String(req, msg);
   }
   else if (msg instanceof Buffer)
   {
      code = tcp.writeBuffer(req, msg);
   }
   else return errno.geterr('EINVAL');

   if (errno.SUCCESS !== code)
   {
      return destroy(tcp, errno.geterr(code));
   }

   if (0 === tcp.writeQueueSize)
   {
      req.emit = false;
      emit(tcp, 'onwrite', req.bytes);
   }

   return null;
};

const server = function (tcp)
{
   Object.defineProperties(tcp._owner,
   {
      bind : { value : function (address, port)
         { return bind(tcp, address, port); }
         , writable : false, enumerable : true
         , configurable : false },
      listen : { value : function (backlog)
         { return listen(tcp, backlog); }
         , writable : false, enumerable : true
         , configurable : false }
   });
};

const agent = function (tcp)
{
   tcp._isagt = true;
   Object.defineProperties(tcp._owner,
   {
      connect : { value : function (address, port)
         { return connect(tcp, address, port); }
         , writable : false, enumerable : true
         , configurable : false },
      write : { value : function (message)
         { return write(tcp, message); }
         , writable : false, enumerable : true
         , configurable : false }
   });
};

const client = function (tcp)
{
   afterconnect(tcp);
   Object.defineProperties(tcp._owner,
   {
      write : { value : function (message)
         { return write(tcp, message); }
         , writable : false, enumerable : true
         , configurable : false }
   });
};

const ip2str = function (ip)
{
   return (6 === cares.isIP(ip) ? '[' + ip + ']' : ip);
};

const toJSON = function (tcp)
{
   let str = (tcp._protocol || 'tcp') + '://' + tcp.fd + ':';
   if (TCP.SERVER === tcp._type)
   {
      str += 'srv@' + ip2str(tcp._sa) + ':' + tcp._sp;
   }
   else
   {
      str += (tcp._isagt ? 'agt' : 'cli') + '@'
         + ip2str(tcp._pa) + ':' + tcp._pp;
   }

   return str;
};

const common = function (tcp)
{
   Object.defineProperties(tcp._owner,
   {
      nodelay : { set : function (on) { nodelay(tcp, on); }
         , enumerable : true, configurable : false },
      keepalive : { set : function (sec) { keepalive(tcp, sec); }
         , enumerable : true, configurable : false },
      ref : { get : function () { return ref(tcp); }
         , set : function (on) { ref(tcp, on); }
         , enumerable : true, configurable : false },
      close : { value : function (force) { return close(tcp, !!force); }
         , writable : false, enumerable : true
         , configurable : false },
      peerAddress : { get : function () { return tcp._pa; }
         , enumerable : true, configurable : false },
      peerPort : { get : function () { return tcp._pp; }
         , enumerable : true, configurable : false },
      sockAddress : { get : function () { return tcp._sa; }
         , enumerable : true, configurable : false },
      sockPort : { get : function () { return tcp._sp; }
         , enumerable : true, configurable : false },
      fd : { get : function () { return tcp.fd; }
         , enumerable : true, configurable : false },
      protocol : { get : function () { return tcp._protocol; }
         , set : function (p) { protocol(tcp, p); }
         , enumerable : true, configurable : false },
      toJSON : { value : function () { return toJSON(tcp); }
         , writable : false, enumerable : true
         , configurable : false }
   });
};

const TCP = function (tcp)
{
   if (tcp instanceof Socket)
   {
      tcp._owner = this;
      client(tcp);
      tcp._type = TCP.CLIENT;
   }
   else
   {
      let create;
      switch (tcp)
      {
         case TCP.CLIENT : create = agent;  break;
         case TCP.SERVER : create = server; break;
         default : throw errno.geterr('EINVAL');
      }
      let type = tcp;
      tcp = new Socket();
      tcp._type = type;
      tcp._owner = this;
      create(tcp);
   }
   common(tcp);
};

TCP.CLIENT = 1;
TCP.SERVER = 0;

module.exports = Object.freeze(TCP);
