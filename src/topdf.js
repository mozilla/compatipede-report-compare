var cradle = require('cradle');
var fs = require('fs');
var PDFDocument = require('pdfkit');
var useragent = require('useragent');


var argv = require('yargs')
  .demand('couchdbUser')
  .describe('couchdbUser', 'Couchdb username')

  .demand('couchdbPassword')
  .describe('couchdbPassword', 'Couchdb password')

  .demand('couchdbPort')
  .describe('couchdbPort', 'Couchdb server listens on port')
  .default('couchdbPort', 5984)

  .demand('outputfile')
  .describe('outputfile', 'Name of PDF-file to write to')

  .argv;

var pdfdoc = new PDFDocument({title:"Compatipede report"});
var stream = pdfdoc.pipe(fs.createWriteStream(argv.outputfile));

var connection = new(cradle.Connection)('http://localhost', argv.couchdbPort, {
    auth: { username: argv.couchdbUser, password: argv.couchdbPassword }
});
var db = connection.database('compatipede-jobs-top-1000');
var processed = {};
var pendingDomains = 0, pendingDocs = 0, pendingAttachments = 0;
var attachment_data = {}; // store attachment meta data per URI until we're ready to insert everything into the document

db.view('jannahJobs/listDomains', {group: true, limit: 30}, function(dberr, res){
  if(dberr){
    console.log(dberr);
    process.exit(1);
  }
  pendingDomains = res.length;
  for(var i = 0; i < res.length; i++){
    var domain = res[i].key;
    db.view('jannahJobs/byDomain', {key: domain}, function (dberr, docs) {
      if(dberr){
        console.log(dberr);
      }
      pendingDomains --;
      pendingDocs += docs.length;
      for(var j = 0; j < docs.length; j++){
        pendingDocs--;
        var doc = docs[j].value;
        if(!processed[doc.jobDetails.targetURI]){
          processed[doc.jobDetails.targetURI] = {};
        }
        if(doc._attachments && Object.keys(doc._attachments).length){
          console.log('Storing meta data for attachments for ' + doc._id + ' domains to do: ' + pendingDomains+' docs to do: ' +pendingDocs + ' attchm to do: ' + pendingAttachments)
          var ua = useragent.parse(doc.jobDetails.userAgent);
          var variant_id = doc.jobDetails.targetURI + ', ' + doc.jobDetails.engine + ', ' + ua.family;
          var url = doc.jobDetails.targetURI;
          if(processed[url][variant_id]){
            continue; // we already had one of those screenshots
          }
          //console.log(doc);
          if(!attachment_data[url]){
            attachment_data[url] = {domain: doc.jobDetails.domain, imgs: []};
          }
          attachment_data[url].imgs.push({doc:doc._id,name:Object.keys(doc._attachments)[0],variant:variant_id});
          pendingAttachments ++;
          processed[url][variant_id] = true;
          for(var att_id in doc._attachments){
            var data = doc._attachments[att_id].screenshot;
            // If we've processed all the meta data, we start fetching the attachments..
            // In other words, j is docs.length, doc is last document, domain is last domain..
            if(pendingDomains === 0 && pendingDocs === 0){
              startAddingAttachments();
            }
          }
        }else{
          console.log('No attachments for ' + doc._id + ' domains to do: ' + pendingDomains+' docs to do: ' +pendingDocs + ' pending attchm ' + pendingAttachments);
          if(pendingDomains === 0 && pendingDocs === 0){
            startAddingAttachments();
          }
        }
      }
    });
  }
});

function startAddingAttachments(){
  process.quit();
  // URL by URL, we start requesting the attachments..
  console.log('Here we go..');
  for(var the_url in attachment_data){
    var the_data = attachment_data[the_url];
    console.log(the_url + ' ' + the_data.imgs.length);
    the_data.loaded = 0;
    the_data.imgs.forEach(function(imgdata, index){
      console.log('Requesting ' + imgdata.doc+', '+imgdata.name);
      db.getAttachment(imgdata.doc, imgdata.name, function(dberr, data){
        pendingAttachments--;
        //console.log(data)
        if(dberr){
          console.log(dberr);
        }
        this.data.imgs[this.idx].body = data.body;
        this.data.loaded++;
        if(this.data.loaded === this.data.imgs.length){
          console.log('Will embed data for '+this.data.domain + ' (attachments left to process: ' + pendingAttachments + ')');
          this.data.imgs = this.data.imgs.sort(function(a,b){return a.variant >= b.variant});
          pdfdoc.font('Times-Roman', 16).text(this.data.domain).font('Times-Roman', 10);
          pdfdoc.moveDown();
          pdfdoc.moveDown();
          pdfdoc.moveDown();
          var ypos = pdfdoc.y, xpos = pdfdoc.x, width = parseInt( ( pdfdoc.page.width - (pdfdoc.x*2)  ) / this.data.imgs.length ) ;
          for(var i = 0; i < this.data.imgs.length; i++){
            pdfdoc.textAnnotation(xpos + (width * i), ypos-20, width, 20, this.data.imgs[i].variant.replace(this.url+', ', ''), {color:'#ccc', fontSize:'9px'});
            try{
              pdfdoc.image(this.data.imgs[i].body, xpos + (width * i), ypos, {width:width});
            }catch(e){
              console.log(e);
            }
          }
          // free all that memory..
          delete attachment_data[this.url];
          delete this.data;
          if(pendingAttachments === 0){
            pdfdoc.end();
          }
        }else{
          console.log('Not yet enough attachments loaded for ' + this.data.domain + ' ( ' + this.data.loaded + '/' + this.data.imgs.length+')' + '(attachments left to process: ' + pendingAttachments + ')');
        }
      }.bind({data:the_data, url:the_url, idx: index}));
    });
  }
}


/*              db.getAttachment(doc._id, att_id, function(dberr, data){
                var doc = this.doc;
                var url = doc.jobDetails.targetURI;
                console.log('attachment ' + pendingAttachments + '  ');
                pendingAttachments--;
                //console.log(data)
                if(dberr){
                  console.log(dberr);
                }
              // if we've processed all documents (pendingDocs and Domains  == 0),
              // we can start going through attachment_data to figure out
              // which ones are completely fetched, insert them
              // and drop the data..
                // we think all data was processed, attachment_data should be complete 
                // (though not all attachments are downloaded yet - this is by design..)
                for(var the_url in attachment_data){
                  var the_data = attachment_data[the_url];
                  // check if all attachments are here
                  var all_attachments_loaded = true;
                  the_data.imgs.forEach(function(data){
                    all_attachments_loaded = all_attachments_loaded && ('data' in data);
                  });
                  if(all_attachments_loaded){ 
                    // insert all
                    pdfdoc.moveDown().font('Times-Roman', 13);
                    pdfdoc.text(doc.jobDetails.domain);
                    pdfdoc.moveDown().font('Times-Roman', 10);
                    pdfdoc.text(the_data);
                    pdfdoc.moveDown().font('Times-Roman', 13);
                    the_data.imgs.forEach(function(imgdata){
                      
                    });
                    // free up some memory
                    delete attachment_data[the_url];
                  }
                }
              }else{
                attachment_data[url].data = data.body;
                pdfdoc.image(data.body);
              }
              if(pendingDocs === 0 && pendingAttachments === 0){
                console.log('finish');
                pdfdoc.end();
              }
            }.bind({doc:doc}));
          }
        }
      }
    });
  }

});*/


stream.on('finish', function() {
  console.log('DONE');
  process.exit(0);
});