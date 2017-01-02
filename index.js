if (module.parent) module.exports = require('./lib/axon');
else
{
   const log = require('./lib/log');
   try
   {
      const opts = require('./options.json');
      const conf = {};
      const args = [];
      require('./lib/getopt')(opts, conf, args
         , '/etc/node-eywa.json', '~/.node-eywa.json');
      log.verbose = conf.verbose;
      log.add(conf.log);
      if (!conf.neuron && conf.log && conf.log.neuron) delete conf.log.neuron;
      (require(conf.neuron ? './lib/neuron' : './lib/axon-shell')
      )(conf).open(args[args.length - 1]);
   }
   catch (ex) { log.emerg(ex); }
}
