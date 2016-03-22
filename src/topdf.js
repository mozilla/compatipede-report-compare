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

  .demand('limits')
  .describe('limits', 'How many domains to get (start,num)')
  .default('limits', '0,50')

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
var pendingUrls = [];
var limits = argv.limits.split(/,/);

db.view('jannahJobs/listDomains', {group: true, skip: limits[0], limit: limits[1]}, function(dberr, res){
  if(dberr){
    console.log(dberr);
    process.exit(1);
  }
  pendingDomains = res.length;
  for(var i = 0; i < res.length; i++){
    db.view('jannahJobs/byDomain', {key: res[i].key}, function (dberr, docs) {
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
            checkIfMetadataComplete();
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
            checkIfMetadataComplete();
          }
        }else{
          console.log('No attachments for ' + doc._id + ' domains to do: ' + pendingDomains+' docs to do: ' +pendingDocs + ' attchm to do: ' + pendingAttachments);
          checkIfMetadataComplete();
        }
      }
    });
  }
});

function checkIfMetadataComplete(){
  if(pendingDomains === 0 && pendingDocs === 0){
    pendingUrls = Object.keys(attachment_data);
    startAddingAttachments();
  }
}

function startAddingAttachments(){
  // URL by URL, we start requesting the attachments..
  var the_url = pendingUrls.shift();
  if(the_url && attachment_data[the_url]){
    console.log(the_url + ' ' + attachment_data[the_url].imgs.length);
  }else{
    pdfdoc.end();
    return;
  }
  var this_data = {};
  attachment_data[the_url].loaded = 0;
  attachment_data[the_url].imgs.forEach(function(imgdata, index){
    console.log('Requesting ' + imgdata.doc+', '+imgdata.name);
    db.getAttachment(imgdata.doc, imgdata.name, (function(dberr, data){
      pendingAttachments--;
      //console.log(data)
      if(dberr){
        console.log(dberr);
      }
      this.data_store[this.idx] = data.body;
      this.data.loaded++;
      if(this.data.loaded === this.data.imgs.length){
        setTimeout(startAddingAttachments, 5); // Trigger another round later on..
        if(pdfdoc.y > (pdfdoc.page.height / 3 * 2)){
          pdfdoc.addPage();
        }
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
            pdfdoc.image(this.data_store[i], xpos + (width * i), ypos, {width:width});
            this.data.imgs[i] = null; // we'll try to make GC happen as soon as possible
          }catch(e){
            console.log(e);
          }
        }
        // Try to let V8 free all that memory..
        delete attachment_data[this.url];
        delete this.data;
        delete this.data_store;
        if(pendingAttachments === 0){
          pdfdoc.end();
        }
      }else{
        console.log('Not yet enough attachments loaded for ' + this.data.domain + ' ( ' + this.data.loaded + '/' + this.data.imgs.length + ', attachments left to process: ' + pendingAttachments + ')');
      }
    }).bind({data:attachment_data[the_url], url:the_url, idx: index, data_store: this_data}));
  });
}

stream.on('finish', function() {
  console.log('DONE');
  process.exit(0);
});