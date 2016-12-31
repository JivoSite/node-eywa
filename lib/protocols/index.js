const fs = process.binding('fs');

const getname = /^([^:/?#]+)\.js$/;
const list = fs.readdir(__dirname);

for (let i = 0; i < list.length; ++i)
{
   let res, name, fun;

   if ('index.js' === list[i])
   {
      continue;
   }
   if (null === (res = getname.exec(list[i])))
   {
      continue;
   }
   name = res[1];
   try
   {
      fun = require('./' + name);
      if ('function' !== typeof fun)
      {
         throw new TypeError('invalid protocol');
      }
      exports[name] = fun;
   }
   catch (ex)
   {
      if (process.stderr.isTTY)
      {
         process.stderr.write('protocols.' + name + ': ' + ex + '\n');
      }
   }
}

Object.freeze(exports);
