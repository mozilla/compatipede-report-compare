== Compatipede data/screenshot comparison tool ==

This tool helps presenting and inspecting data collected by [Compatipede](https://github.com/mozilla/compatipede)

To use, clone this repository, and run `npm install`.

Then run `npm run build.js` followed by `node dist/index.js` with all required arguments:

Options:
  --couchdbUser      Couchdb username                                 [required]
  --couchdbPassword  Couchdb password                                 [required]
  --couchdbHost      Couchdb host              [required] [default: "localhost"]
  --couchdbPort      Couchdb port                     [required] [default: 5984]
  --couchdbDb        Couchdb database                                 [required]

You should now be able to browse the generated Compatipede data on http://localhost:8071
