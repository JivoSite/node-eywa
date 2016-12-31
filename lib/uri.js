const DEFPORT =
{
   http  : 80,
   https : 443,
   ws    : 80,
   wss   : 443,
   ion   : 1024,
   ions  : 1025
};

exports.NONE      = 0x00;
exports.USERINFO  = 0x01;
exports.HOST      = 0x02;
exports.PORT      = 0x04;
exports.AUTHORITY = 0x07;
exports.PATH      = 0x08;
exports.QUERY     = 0x10;
exports.FULL      = 0x1F;

const PURI =
/^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?/;
//   { scheme }          {authori}ty{ path }     {query}      {fr}agment

const PAUTH =
/^(?:([^@]*)@)?(?:([^\:]*)|(?:\[([^\[\]]*)\]))(?::([0-9]*))?$/;
//   {useri}nfo   { host }      {  ipv6  }        { port }

const encode = function (name, str)
{
   if (!str) return '';
   if ('string' !== typeof str)
   {
      throw new URIError('invalid component `' + name + '`');
   }
   try { str = encodeURI(str); }
   catch (ex)
   {
      throw new URIError('invalid component `' + name + '`: '
         + ex.message);
   }
   if ('authority' !== name)
   {
      str = str.replace(/\@/g, '%40');
   }
   else
   {
      str = str.replace(/%5B/g, '[');
      str = str.replace(/%5D/g, ']');
   }
   if ('query' !== name)
   {
      str = str.replace(/\&/g, '%26');
      str = str.replace(/\=/g, '%3D');
   }
   else
   {
      str = str.replace(/%2526/g, '%26');
      str = str.replace(/%253D/g, '%3D');
   }
   switch (name)
   {
      case 'scheme'    : str = str.replace(/\:/g, '%3A');
      case 'authority' : str = str.replace(/\//g, '%2F');
      case 'path'      : str = str.replace(/\?/g, '%3F');
      case 'query'     : str = str.replace(/\#/g, '%23');
      case 'fragment'  :
      default          :
         str = str.replace(/\$/g, '%24');
         str = str.replace(/\+/g, '%2B');
         str = str.replace(/\,/g, '%2C');
         str = str.replace(/\;/g, '%3B');
         break;
   }
   switch (name)
   {
      case 'scheme'    : str = str + ':';  break;
      case 'authority' : str = '//' + str; break;
      case 'query'     : str = '?' + str;  break;
      case 'fragment'  : str = '#' + str;  break;
   }

   return str;
};

const decode = function (name, str)
{
   if (!str)
   {
      return str;
   }
   if ('string' !== typeof str)
   {
      throw new URIError('invalid component `' + name + '`');
   }
   try { str = decodeURI(str); }
   catch (ex)
   {
      throw new URIError('invalid component `' + name + '`: '
         + ex.message);
   }
   if ('authority' !== name)
   {
      str = str.replace(/%40/g, '@');
   }
   if ('query' !== name)
   {
      str = str.replace(/%26/g, '&');
      str = str.replace(/%3D/g, '=');
   }
   switch (name)
   {
      case 'scheme'    : str = str.replace(/%3A/g, ':');
      case 'authority' : str = str.replace(/%2F/g, '/');
      case 'path'      : str = str.replace(/%3F/g, '?');
      case 'query'     : str = str.replace(/%23/g, '#');
      case 'fragment'  :
      default :
         str = str.replace(/%24/g, '$');
         str = str.replace(/%2B/g, '+');
         str = str.replace(/%2C/g, ',');
         str = str.replace(/%3B/g, ';');
         break;
   }

   return str;
};

const def = function (str)
{
   if ('string' !== typeof str)
   {
      return void 0;
   }

   return String(str);
};

exports.parse = function (str, flags, defs)
{
   flags << 0;
   defs = defs || {};
   let r = PURI.exec(str);
   if (null === r)
   {
      throw new URIError('invalid uri');
   }
   let obj =
   {
        scheme    : decode('scheme',    r[1]) || def(defs.scheme)
      , authority : decode('authority', r[2])
      , path      : decode('path',      r[3]) || def(defs.path)
      , query     : decode('query',     r[4]) || def(defs.query)
      , fragment  : decode('fragment',  r[5]) || def(defs.fragment)
   };
   if (exports.NONE >= flags)
   {
      return obj;
   }
   if (flags & exports.AUTHORITY && void 0 !== obj.authority
      && null !== (r = PAUTH.exec(obj.authority)))
   {
      if (flags & exports.USERINFO)
      {
         obj.userinfo = r[1] || def(defs.userinfo);
         if (obj.userinfo)
         {
            obj.userinfo = obj.userinfo.replace(/%40/g, '@').split(':');
            for (let i = 0; i < obj.userinfo.length; ++i)
            {
               obj.userinfo[i] = obj.userinfo[i].replace(/%3A/g, ':');
            }
         }
      }
      if (flags & exports.HOST)
      {
         obj.host = (void 0 === r[2] ? r[3] : r[2]);
         if (void 0 === obj.host) obj.host = def(defs.host);
      }
      if (flags & exports.PORT)
      {
         obj.port = (r[4] || def(defs.port)) << 0;
         if (obj.port !== (obj.port & 0xFFFF))
         {
            throw new URIError('invalid port');
         }
         if (0 === obj.port) obj.port = DEFPORT[obj.scheme] || 0;
      }
   }
   if (flags & exports.PATH && void 0 !== obj.path)
   {
      obj.path = obj.path.split(/\/+(?:\.(?:\/+|$))*/);
      for (let i = 0; i < obj.path.length; ++i)
      {
         if ('..' === obj.path[i])
         {
            if (i)
            {
               obj.path.splice(i - 1, 2);
               i = i - 2;
            }
            else obj.path.splice(i--, 1);
         }
      }
   }
   if (flags & exports.QUERY && void 0 !== obj.query)
   {
      let val, pair, query = obj.query.split(/[?&]+/);
      obj.query = {};
      obj.args = [];
      for (let i = 0; i < query.length; ++i)
      {
         pair = query[i].replace(/%26/g, '&').replace(/%3F/, '?');
         obj.args.push(pair.replace(/%3D/g, '='));
         pair = pair.split('=');
         if (0 === pair.length) continue;
         if (1 === pair.length)
         {
            obj.query[pair[0].replace(/%3D/g, '=')] = true;
            continue;
         }
         val = pair[pair.length - 1].replace(/%3D/g, '=');
         for (let j = 0; j < pair.length - 1; ++j)
         {
            obj.query[pair[j].replace(/%3D/g, '=')] = val;
         }
      }
   }

   return obj;
};

const encodeQC = function (str)
{
   return String(str).replace(/\&/g, '%26').replace(/\=/g, '%3D');
};

exports.stringify = function (obj)
{
   if (null === obj || 'object' !== typeof obj)
   {
      throw new URIError('invalid uri object');
   }
   let path, query;

   if (obj instanceof Array)
   {
      path = obj.join('/');
   }
   else
   {
      if (obj.path instanceof Array) path = obj.path.join('/');
      else path = obj.path;
      if (null !== obj.query && 'object' === typeof obj.query)
      {
         query = '';
         for (let i in obj.query)
         {
            query += ('' !== query ? '&' : '') + encodeQC(i)
               + (true === obj.query[i]
                  ? '' : '=' + encodeQC(obj.query[i]));
         }
      }
      else query = obj.query;
   }

   return encode('scheme', obj.scheme)
        + encode('authority', obj.authority)
        + encode('path', path)
        + encode('query', query)
        + encode('fragment', obj.fragment);
};

Object.freeze(exports);
