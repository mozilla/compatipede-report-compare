var http = require('http');
var node_static = require('node-static');
var url = require('url');

var fileserver = new(node_static.Server)(__dirname + '/static/');

var argv = require('yargs')
  .demand('couchdbUser')
  .describe('couchdbUser', 'Couchdb username')

  .demand('couchdbPassword')
  .describe('couchdbPassword', 'Couchdb password')

  .demand('couchdbHost')
  .describe('couchdbHost', 'Couchdb host')
  .default('couchdbHost', 'localhost')

  .demand('couchdbPort')
  .describe('couchdbPort', 'Couchdb port')
  .default('couchdbPort', 5984)

  .demand('couchdbDb')
  .describe('couchdbDb', 'Couchdb database')

  .argv;

function e500(http_res, msg){
  http_res.writeHead(500, 'Internal error');
  http_res.end(msg);
}

http.createServer(function (req, http_res) {
  console.log(req.method + ' ' + req.url);
  fileserver.serve(req, http_res, function(err, result){
    if(err) { // The request is not for a static file
      var response = '';
      var queryObject = url.parse(req.url,true).query;
      console.log(queryObject);

      var cradle = require('cradle');
      var connection = new(cradle.Connection)('http://localhost', 5984, {
          auth: { username: argv.couchdbUser, password: argv.couchdbPassword }
      });
      var db = connection.database(argv.couchdbDb);

      // Various GETs we need:
      // GET /   Main app HTML (linking to JS and CSS)
      if(req.url === '/') {
        http_res.writeHead(200, {'Content-Type': 'text/html'});
        http_res.write('<!DOCTYPE html><html><head><title>Compatipede data reports</title>\n');
        http_res.write('<link href="/css/style.css" rel="stylesheet">\n');
        http_res.write('<link href="/css/jsondiffpatch/html.css" rel="stylesheet">\n');
        http_res.write('<script src="/js/resemble.js"></script>');
        http_res.write('<script src="/js/jsondiffpatch/jsondiffpatch.js"></script>');
        http_res.write('<script src="/js/jsondiffpatch/jsondiffpatch-formatters.js"></script>');
        http_res.write('<script src="/js/ui.js"></script></head>\n');
        http_res.end('<body><h1>Compatipede data reports</h1><div id="controls"></div></body></html>');

      }else if('attachment' in queryObject) {
        // GET /?attachment=X&doc=Y  "attachment id x"
        db.getAttachment(queryObject.doc, queryObject.attachment, function(dberr, data){
          if(dberr){
            e500(http_res, dberr);
          }
          http_res.writeHead(200, {'Content-Type': 'image/png'});
          http_res.end(data.body, 'binary');
        });
      }else if(queryObject.domains) {
        // GET /?domains=0-10 "listing domains n ... o by order in DB"
        var limits = queryObject.domains.split(/\-/);
        db.view('hallvord/listDomains', {skip: limits[0], limit: limits[1], group: true}, function(dberr, res){
          if(dberr){
            e500(http_res, dberr);
          }
          http_res.writeHead(200, {'Content-Type': 'application/json'});
          http_res.end(JSON.stringify(res, null, 2));
        });
      } else if(queryObject.domain) {
        // GET /?domain=example.com  "docs (aka jobs) by domain"
        db.view('hallvord/byDomain', {key: queryObject.domain}, function (dberr, res) {
          if(dberr){
            e500(http_res, dberr);
          }
          http_res.writeHead(200, {'Content-Type': 'application/json'});
          if(queryObject.withResources === 'false') {
            res.forEach(function(obj) {
              if('jobResults' in obj) {
                delete obj.jobResults.resources;
              }
            });
          }
          http_res.writeHead(200, {'Content-Type': 'application/json'});
          http_res.end(JSON.stringify(res, null, 2));
        });

      }
      req.on('error', function(err) {
        console.error(err);
      });
      http_res.on('error', function(err) {
        console.error(err);
      });
    }
  });

}).listen(8071);

console.log('Listening on 8071');

/*// if there is POST data (TODO: do we need this?)
      var body = [];
      req.on('data', function(chunk) {
        body.push(chunk);
      }).on('end', function() {
        body = Buffer.concat(body).toString();
      });
*/
