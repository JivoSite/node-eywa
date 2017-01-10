const binding    = process.binding('http_parser');
const methods    = binding.methods;
const HTTPParser = binding.HTTPParser;

const BODYLEN = 64 * 1024; // max body size in bytes
const spare = [];

const emit = function(owner, name, e)
{
   if ('function' === typeof owner[name]) owner[name](e);
};

const SRV = 'Server: neuron\r\n';
const HOK = Buffer.from('HTTP/1.1 200 OK\r\n'
   + 'Connection: keep-alive\r\n'
   + 'Content-Type: text/plain; charset=utf-8;\r\n'
   + 'Cache-Control: no-cache, no-store, must-revalidate\r\n'
   + 'Pragma: no-cache\r\n'
   + 'Expires: 0\r\n'
   + SRV
   + 'Content-length: ');
const HRS = 'HTTP/1.1 ';
const ALW = '\r\nAllow: GET, POST, OPTIONS';
const HRE = '\r\n' + SRV + 'Connection: close\r\n\r\n';

const hre =
{
     0 : Buffer.from(HRS + '200 OK'                        + ALW + HRE),
   400 : Buffer.from(HRS + '400 Bad Request'                     + HRE),
   401 : Buffer.from(HRS + '401 Unauthorized'                    + HRE),
   402 : Buffer.from(HRS + '402 Payment Required'                + HRE),
   403 : Buffer.from(HRS + '403 Forbidden'                       + HRE),
   404 : Buffer.from(HRS + '404 Not Found'                       + HRE),
   405 : Buffer.from(HRS + '405 Method Not Allowed'        + ALW + HRE),
   406 : Buffer.from(HRS + '406 Not Acceptable'                  + HRE),
   407 : Buffer.from(HRS + '407 Proxy Authentication Required'   + HRE),
   408 : Buffer.from(HRS + '408 Request Timeout'                 + HRE),
   409 : Buffer.from(HRS + '409 Conflict'                        + HRE),
   410 : Buffer.from(HRS + '410 Gone'                            + HRE),
   411 : Buffer.from(HRS + '411 Length Required'                 + HRE),
   412 : Buffer.from(HRS + '412 Precondition Failed'             + HRE),
   413 : Buffer.from(HRS + '413 Request Entity Too Large'        + HRE),
   414 : Buffer.from(HRS + '414 Request-URI Too Large'           + HRE),
   415 : Buffer.from(HRS + '415 Unsupported Media Type'          + HRE),
   416 : Buffer.from(HRS + '416 Requested Range Not Satisfiable' + HRE),
   417 : Buffer.from(HRS + '417 Expectation Failed'              + HRE),
   418 : Buffer.from(HRS + '418 I\'m a teapot'                   + HRE),
   422 : Buffer.from(HRS + '422 Unprocessable Entity'            + HRE),
   423 : Buffer.from(HRS + '423 Locked'                          + HRE),
   424 : Buffer.from(HRS + '424 Failed Dependency'               + HRE),
   425 : Buffer.from(HRS + '425 Unordered Collection'            + HRE),
   426 : Buffer.from(HRS + '426 Upgrade Required'                + HRE),
   428 : Buffer.from(HRS + '428 Precondition Required'           + HRE),
   429 : Buffer.from(HRS + '429 Too Many Requests'               + HRE),
   431 : Buffer.from(HRS + '431 Request Header Fields Too Large' + HRE),
   434 : Buffer.from(HRS + '434 Requested host unavailable.'     + HRE),
   444 : Buffer.from(HRS + '444 '                                + HRE),
   449 : Buffer.from(HRS + '449 Retry With'                      + HRE),
   451 : Buffer.from(HRS + '451 Unavailable For Legal Reasons'   + HRE),
   500 : Buffer.from(HRS + '500 Internal Server Error'           + HRE),
   501 : Buffer.from(HRS + '501 Not Implemented'                 + HRE),
   502 : Buffer.from(HRS + '502 Bad Gateway'                     + HRE),
   503 : Buffer.from(HRS + '503 Service Unavailable'             + HRE),
   504 : Buffer.from(HRS + '504 Gateway Timeout'                 + HRE),
   505 : Buffer.from(HRS + '505 HTTP Version Not Supported'      + HRE),
   506 : Buffer.from(HRS + '506 Variant Also Negotiates'         + HRE),
   507 : Buffer.from(HRS + '507 Insufficient Storage'            + HRE),
   508 : Buffer.from(HRS + '508 Loop Detected'                   + HRE),
   509 : Buffer.from(HRS + '509 Bandwidth Limit Exceeded'        + HRE),
   510 : Buffer.from(HRS + '510 Not Extended'                    + HRE),
   511 : Buffer.from(HRS + '511 Network Authentication Required' + HRE)
};

const serialize = function (msg, type)
{
   if ('number' === typeof msg)
   {
      if (msg in hre) return hre[msg];
      else return hre[500];
   }
   else if (msg instanceof Buffer && 0x0A === msg[msg.length - 1]
      && !type && 0x21 === msg[0]) // neuron confirm
   {
      let off = 0, end = msg.length - 1, tc = 0;
      while (end > ++off)
      {
         if (0x09 === msg[off])
         {
            if (2 === ++tc)
            {
               ++off;
               break;
            }
         }
      }
      if (2 !== tc) off = end;
      let l = end - off;
      let len = Buffer.from(l + '\r\n\r\n');
      let buf = Buffer.allocUnsafe(HOK.length + len.length + l);
      HOK.copy(buf, 0, 0, HOK.length);
      len.copy(buf, HOK.length, 0, len.length);
      msg.copy(buf, HOK.length + len.length, off, end);
      return buf;
   }
   else throw new Error('not implemented');
};

const addHeader = function (obj, key, val)
{
	key = key.toLowerCase();
	if (obj[key]) obj[key] += ', ' + val;
	else          obj[key]  = val;
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

const onHeaders = function (headers, url)
{
};
const onHeadersComplete = function (major, minor
                                    , headers
                                    , method, url
                                    , code, message
                                    , upgrade, alive)
{
   let hs = {};

   for (let i = 0; i < headers.length; i += 2)
   {
      addHeader(hs, headers[i], headers[i + 1]);
   }
   this._message =
   {
      major   : major,
      minor   : minor,
      headers : hs,
      method  : methods[method],
      url     : url,
      upgrade : upgrade,
      alive   : alive
   };
   if (-1 !== url.indexOf('?')) return 1;

   return 0;
};

const onBody = function (buf, off, len)
{
   if (this._message)
   {
      this._message.body = append(this._message.body, buf, off, off + len);
   }
};

const onMessageComplete = function ()
{
   emit(this, 'onmessage', this._message);
   this._message = null;
};

const onExecute = function ()
{
};

module.exports = function (type)
{
   type = (type ? 0 : 1); // REQUEST 0, RESPONSE 1
   let _hp = spare.pop();

   if (_hp) _hp.reinitialize(type);
   else
   {
      _hp = new HTTPParser(type);
      _hp[HTTPParser.kOnHeaders]         = onHeaders;
      _hp[HTTPParser.kOnHeadersComplete] = onHeadersComplete;
      _hp[HTTPParser.kOnBody]            = onBody;
      _hp[HTTPParser.kOnMessageComplete] = onMessageComplete;
      _hp[HTTPParser.kOnExecute]         = onExecute;
   }

   _hp.parse = function (buf, off, len)
   {
      let n = _hp.execute(buf);
      if (n instanceof Error) throw n;
      return n;
   };

   _hp.serialize = function (msg)
   {
      return serialize(msg, type);
   };

   _hp.destroy = function ()
   {
      if ('_message' in _hp) delete _hp._message;
      if (1024 < spare.length)
      {
         _hp.close();
         _hp[HTTPParser.kOnHeaders]         = null;
         _hp[HTTPParser.kOnHeadersComplete] = null;
         _hp[HTTPParser.kOnBody]            = null;
         _hp[HTTPParser.kOnMessageComplete] = null;
         _hp[HTTPParser.kOnExecute]         = null;
      }
      else spare.push(_hp);
      _hp  = null;
   };

   return _hp;
};
