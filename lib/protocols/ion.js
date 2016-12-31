const empty = Buffer.from('\n');

const emit = function(owner, name, e)
{
   if ('function' === typeof owner[name]) owner[name](e);
};

const append = function (dest, src, off, end)
{
   let len = end - off, buf;
   if (0 === len)
   {
      buf = dest;
   }
   else if (dest instanceof Buffer && 0 !== dest.length)
   {
      buf = Buffer.allocUnsafe(len + dest.length);
      dest.copy(buf, 0, 0, dest.length);
      src.copy(buf, dest.length, off, end);
   }
   else
   {
      buf = Buffer.allocUnsafe(len);
      src.copy(buf, 0, off, end);
   }
   return buf;
};

const serialize = function (msg)
{
   if (msg instanceof Buffer) return msg;
   else if ('string' === typeof msg)
   {
      if (-1 !== msg.indexOf('\n'))
      {
         throw new Error('LF in ion string message');
      }
      return Buffer.from(msg + '\n');
   }
   else throw new TypeError('ion message must be string or buffer');
};

const parse = function (owner, buf, off, len)
{
   let end = off + len, i = off, o = off;
   if (!(buf instanceof Buffer))
   {
      throw new TypeError('invalid buffer');
   }
   if (buf.length <= off || 0 > off)
   {
      throw new Error('offset is out of bounds');
   }
   if (0 > len)
   {
      throw new Error('length is out of bounds');
   }
   if (buf.length < end)
   {
      throw new Error('end is out of bounds');
   }
   if (i === end) return 0;
   while (true)
   {
      if (0x0A === buf[i]) // LF
      {
         owner._message = append(owner._message, buf, o, ++i);
         emit(owner, 'onmessage', owner._message);
         owner._message = null;
         o = i;
      }
      else ++i;
      if (i === end)
      {
         owner._message = append(owner._message, buf, o, i);
         break;
      }
   }
   return i - off;
};

module.exports = function (type)
{
   return Object.defineProperties({},
   {
      parse : { value : function (buf, off, len)
         { return parse(this, buf, off, len); }
         , writable : false, enumerable : true
         , configurable : false },
      serialize : { value : serialize
         , writable : false, enumerable : true
         , configurable : false },
      destroy : { value : function () { this._message = null; }
         , writable : false, enumerable : true
         , configurable : false }
   });
};
