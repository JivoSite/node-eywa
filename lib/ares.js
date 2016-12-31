const cares = process.binding('cares_wrap');
const errno = require('./errno');
const RWrap = cares.GetAddrInfoReqWrap;

exports.isIP = cares.isIP;

exports.UNSPEC = 0;
exports.INET   = 4;
exports.INET6  = 6;

exports.ADDRCONFIG = cares.AI_ADDRCONFIG;
exports.V4MAPPED   = cares.AI_V4MAPPED;

const HINTS = cares.AI_ADDRCONFIG & cares.AI_V4MAPPED

exports.getaddrinfo = function (address, family, hints, cb)
{
   if ('function' !== typeof cb)
   {
      throw new TypeError('ares: invalid callback');
   }
   if (7 !== (family | 7) || 2 === family || 3 === family)
   {
      throw new RangeError('ares: invalid family');
   }
   hints = (null === hints || void 0 === hints
      ? HINTS
      : hints & HINTS);
   if ('' === address)
   {
      switch (family)
      {
         case 0 :
         case 4 : return cb(null, [  '0.0.0.0']); break;
         case 1 :
         case 5 : address = 'localhost';          break;
         case 6 : return cb(null, [       '::']); break;
         case 7 : address = 'localhost';          break;
      }
   }
   else if ('string' !== typeof address)
   {
      throw new TypeError('ares: invalid address');
   }
   family &= 6;
   let req = new RWrap();
   req.oncomplete = function (status, ips)
   {
      if (errno.SUCCESS !== status)
      {
         cb(new Error('ares: ' + errno.gettext(status)));
      }
      else if (ips instanceof Array && ips.length)
      {
         if (4 === family && 'localhost' === address
            && 1 < ips.length && '127.0.0.1' === ips[0])
         {
            ips.shift();
         }
         cb(null, ips);
      }
      else cb(new Error('ares: no result'));
   };
   let code = cares.getaddrinfo(req, address, family, hints);
   if (code)
   {
      cb(new Error('ares: ' + errno.gettext(code)));
   }
};

Object.freeze(exports);
