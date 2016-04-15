var cradle = require('cradle');
var fs = require('fs');
var im = require('imagemagick');
var PDFDocument = require('pdfkit');
var sizeOf = require('image-size');
var tmpfile = require('tmp');
var useragent = require('useragent');


var argv = require('yargs')
  .demand('couchdbUser')
  .describe('couchdbUser', 'Couchdb username')

  .demand('couchdbPassword')
  .describe('couchdbPassword', 'Couchdb password')

  .demand('couchdbPort')
  .describe('couchdbPort', 'Couchdb server listens on port')
  .default('couchdbPort', 5984)

  .demand('couchdbDb')
  .describe('couchdbDb', 'Couchdb DB to pull data from')

  .demand('outputfile')
  .describe('outputfile', 'Name of PDF-file to write to')

  .demand('limits')
  .describe('limits', 'How many domains to get (start,num)')
  .default('limits', '0,50')

  .argv;

var pdfdoc = new PDFDocument({title:"Compatipede report", size: "A3"});
var stream = pdfdoc.pipe(fs.createWriteStream(argv.outputfile));

var connection = new(cradle.Connection)('http://localhost', argv.couchdbPort, {
    auth: { username: argv.couchdbUser, password: argv.couchdbPassword }
});
var db = connection.database(argv.couchdbDb);
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
        var ua = useragent.parse(doc.jobDetails.userAgent);
        if(doc._attachments && Object.keys(doc._attachments).length && ua.family !== 'Mobile Safari'){
          console.log('Storing meta data for attachments for ' + doc._id + ' domains to do: ' + pendingDomains+' docs to do: ' +pendingDocs + ' attchm to do: ' + pendingAttachments)
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
    return;
  }
  var this_data = []; // per URL, should not be kept alive (hopefully)
  attachment_data[the_url].loaded = 0; // measures how many of the images are ready to insert
  var width = parseInt( ( pdfdoc.page.width - (pdfdoc.page.margins.left + pdfdoc.page.margins.right)  ) / attachment_data[the_url].imgs.length ); // How wide *these* images need to be
  // Before we start loading: Make sure the order is predictable..
  attachment_data[the_url].imgs = attachment_data[the_url].imgs.sort(function(a,b){return a.variant >= b.variant});
  attachment_data[the_url].imgs.forEach(function(imgdata, index){
    console.log('Requesting ' + imgdata.doc + ', ' + imgdata.name + ', will resize to ' + width);
    db.getAttachment(imgdata.doc, imgdata.name, (function(dberr, data){
      pendingAttachments--;
      if(dberr){
        console.log(dberr);
      }
      // start resizing image
      this.tmpfn = tmpfile.tmpNameSync({postfix:'.png'});
        im.resize({srcData: data.body, srcFormat: 'png', width: width, format: 'png', dstPath: this.tmpfn}, (function(err, stdout, stderr){
          if(err){
            console.log('Will skip image due to resize error ', err);
            this.data_store[this.idx] = null;
            attachment_data[this.url].loaded++;
          }else{
            this.data_store[this.idx] = this.tmpfn;
            attachment_data[this.url].loaded++;
            console.log('Resized ' + attachment_data[this.url].loaded + ' images of ' + attachment_data[this.url].imgs.length + ' for ' + this.url);
          }
          if(attachment_data[this.url].loaded === attachment_data[this.url].imgs.length){
            reallyInsertAttachments(this.url, this.data_store, width);
          }else{
              console.log('Not yet enough attachments loaded for ' + attachment_data[this.url].domain + ' ( ' + attachment_data[this.url].loaded + '/' + attachment_data[this.url].imgs.length + ', attachments left to process: ' + pendingAttachments + ')');
          }
        }).bind(this));
    }).bind({url:the_url, idx: index, data_store: this_data}));
  });
}
function reallyInsertAttachments(url, data_store, width){
  var heights = [];
  var data = attachment_data[url];
  console.log('Will embed data for '+data.domain + ' (attachments left to process: ' + pendingAttachments + ')');
  pdfdoc.font('Times-Roman', 16).text(data.domain, pdfdoc.page.margins.left).font('Times-Roman', 10);
  pdfdoc.moveDown(2);
  var ypos = pdfdoc.y, xpos = pdfdoc.page.margins.left;
  pdfdoc.x = xpos;
  for(var i = 0; i < data_store.length; i++){
    if(!data_store[i]){
      continue;
    }
    heights.push(sizeOf(data_store[i]).height);
    try{
      pdfdoc.save().fontSize(9).fillAndStroke('#ccc', '#fff').text(data.imgs[i].variant.replace(url+', ', ''), xpos + (width * i), ypos-20, {width:width, height:20});
      pdfdoc.restore().image(data_store[i], xpos + (width * i), ypos, {width:width});
      data.imgs[i] = data_store[i] = null; // we'll try to make GC happen as soon as possible
    }catch(e){
      console.log(e);
    }
  }
  // Tallest inserted image was..
  var tallestHeight = Math.max.apply(Math, heights);
  console.log('b4 ' + pdfdoc.y);
  pdfdoc.y = parseInt(pdfdoc.y + tallestHeight);
  console.log('after ' + pdfdoc.y + ' expected ' + (pdfdoc.y + tallestHeight));
  // Try to let V8 free all that memory..
  delete attachment_data[this.url];
  console.log('done ' + i + ' embeds, pending ' + pendingAttachments + ', (urls: ' + pendingUrls.length + ' )');
  if(pendingUrls.length > 0){
    if(pdfdoc.y > (pdfdoc.page.height / 2)){
      pdfdoc.addPage();
    }
    setTimeout(startAddingAttachments, 15); // Trigger another round later on..
  }else if(pendingAttachments === 0){
    pdfdoc.end();
  }
};

stream.on('finish', function() {
  console.log('DONE');
  process.exit(0);
});
